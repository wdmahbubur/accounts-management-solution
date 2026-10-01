-- US-013: pure calculation only. No ledger mutation or tax-policy approval.
BEGIN;
CREATE FUNCTION finance_private.calculation_decimal(p_value jsonb,p_money boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE v text:=p_value#>>'{}';
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' OR length(v)>22 OR
    (p_money AND (v !~ '^-?(0|[1-9][0-9]{0,17})\.[0-9]{2}$' OR v='-0.00')) OR
    (NOT p_money AND v !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,6})?$') THEN
    RAISE EXCEPTION 'invalid canonical decimal' USING ERRCODE='22023';
  END IF;
  RETURN v::numeric;
END $$;
REVOKE ALL ON FUNCTION finance_private.calculation_decimal(jsonb,boolean) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION finance_private.calculation_decimal(jsonb,boolean) TO authenticated;

CREATE FUNCTION public.calculate_document_preview(p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE l jsonb; q numeric; price numeric; rate numeric; base numeric; disc numeric;
  net numeric; tax numeric; gross numeric; percent numeric; x numeric;
  sum_base numeric:=0; sum_discount numeric:=0; sum_net numeric:=0;
  sum_tax numeric:=0; sum_gross numeric:=0; adjustment numeric:=0;
  r jsonb; result_lines jsonb:='[]';
BEGIN
  IF jsonb_typeof(p_input) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'expected preview object' USING ERRCODE='22023';
  END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_input) k WHERE k NOT IN ('currency','lines','rounding'))
    OR p_input->>'currency' IS DISTINCT FROM 'BDT'
    OR jsonb_typeof(p_input->'lines') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'invalid preview contract or currency' USING ERRCODE='22023';
  END IF;
  IF jsonb_array_length(p_input->'lines') NOT BETWEEN 1 AND 1000 THEN
    RAISE EXCEPTION 'expected 1 to 1000 lines' USING ERRCODE='22023';
  END IF;
  FOR l IN SELECT value FROM jsonb_array_elements(p_input->'lines') LOOP
    IF jsonb_typeof(l) IS DISTINCT FROM 'object' THEN
      RAISE EXCEPTION 'invalid line' USING ERRCODE='22023';
    END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(l) k WHERE k NOT IN
      ('quantity','unit_price','discount_amount','discount_percent','tax_rate','tax_mode'))
      OR COALESCE(l->>'tax_mode','') NOT IN ('inclusive','exclusive')
      OR (l?'discount_amount' AND l?'discount_percent') THEN
      RAISE EXCEPTION 'invalid line contract' USING ERRCODE='22023';
    END IF;
    q:=finance_private.calculation_decimal(l->'quantity');
    price:=finance_private.calculation_decimal(l->'unit_price');
    rate:=finance_private.calculation_decimal(l->'tax_rate');
    IF q<=0 OR rate>100 THEN RAISE EXCEPTION 'invalid quantity or rate' USING ERRCODE='22023'; END IF;
    base:=round(q*price,2); disc:=0;
    IF l?'discount_amount' THEN disc:=finance_private.calculation_decimal(l->'discount_amount',true); END IF;
    IF l?'discount_percent' THEN
      percent:=finance_private.calculation_decimal(l->'discount_percent');
      IF percent>100 THEN RAISE EXCEPTION 'invalid discount' USING ERRCODE='22023'; END IF;
      disc:=round(base*percent/100,2);
    END IF;
    IF disc<0 OR disc>base THEN RAISE EXCEPTION 'discount exceeds base' USING ERRCODE='22023'; END IF;
    x:=base-disc;
    IF l->>'tax_mode'='inclusive' THEN
      -- Integer-cent quotient avoids premature precision loss in numeric division.
      net:=div(2*x*100*100000000+(100000000+rate*1000000),2*(100000000+rate*1000000))/100;
      tax:=x-net; gross:=x;
    ELSE net:=x; tax:=round(net*rate/100,2); gross:=net+tax;
    END IF;
    IF greatest(base,disc,net,tax,gross)>=1000000000000000000 THEN
      RAISE EXCEPTION 'monetary overflow' USING ERRCODE='22003';
    END IF;
    result_lines:=result_lines||jsonb_build_array(jsonb_build_object(
      'base',base::numeric(20,2)::text,'discount',disc::numeric(20,2)::text,
      'net',net::numeric(20,2)::text,'tax',tax::numeric(20,2)::text,'gross',gross::numeric(20,2)::text));
    sum_base:=sum_base+base; sum_discount:=sum_discount+disc;
    sum_net:=sum_net+net; sum_tax:=sum_tax+tax; sum_gross:=sum_gross+gross;
  END LOOP;
  IF p_input?'rounding' THEN
    r:=p_input->'rounding';
    IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'invalid rounding object' USING ERRCODE='22023'; END IF;
    IF EXISTS(SELECT 1 FROM jsonb_object_keys(r) k WHERE k NOT IN ('amount','reason','account_id'))
      OR jsonb_typeof(r->'reason') IS DISTINCT FROM 'string'
      OR length(btrim(COALESCE(r->>'reason','')))=0 OR length(r->>'reason')>500
      OR COALESCE(r->>'account_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RAISE EXCEPTION 'rounding requires explicit account and reason' USING ERRCODE='22023';
    END IF;
    adjustment:=finance_private.calculation_decimal(r->'amount',true);
    IF abs(adjustment)>0.05 THEN RAISE EXCEPTION 'rounding exceeds 0.05 BDT' USING ERRCODE='22023'; END IF;
  END IF;
  IF sum_gross+adjustment<0 OR greatest(sum_base,sum_discount,sum_net,sum_tax,sum_gross,sum_gross+adjustment)>=1000000000000000000 THEN
    RAISE EXCEPTION 'invalid document total or overflow' USING ERRCODE='22003';
  END IF;
  RETURN jsonb_build_object('currency','BDT','lines',result_lines,
    'base',sum_base::numeric(20,2)::text,'discount',sum_discount::numeric(20,2)::text,
    'net',sum_net::numeric(20,2)::text,'tax',sum_tax::numeric(20,2)::text,'gross',sum_gross::numeric(20,2)::text,
    'rounding_adjustment',adjustment::numeric(20,2)::text,'total',(sum_gross+adjustment)::numeric(20,2)::text);
END $$;
REVOKE ALL ON FUNCTION public.calculate_document_preview(jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_document_preview(jsonb) TO authenticated;
NOTIFY pgrst,'reload schema';
COMMIT;
