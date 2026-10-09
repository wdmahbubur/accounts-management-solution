-- US-038 / US-040: original-line selection and authoritative cumulative credit caps.
-- Drafts and approvals reserve nothing. Every committed credit consumes capacity
-- from its accounting date until its posted reversal date. The minimum remaining
-- capacity from the proposed date onward also protects future dated credits.
CREATE FUNCTION finance_private.credit_remaining_capacity(
  p_organization_id uuid, p_original_document_id uuid, p_accounting_date date, p_exclude_document_id uuid DEFAULT NULL
) RETURNS TABLE(original_line_id uuid, remaining_quantity numeric, remaining_net_amount numeric,
  remaining_tax_amount numeric, remaining_gross_amount numeric, remaining_total_amount numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  WITH originals AS (
    SELECT l.* FROM finance.document_lines l
    WHERE l.organization_id=p_organization_id AND l.document_id=p_original_document_id
  ), credits AS (
    SELECT d.id,d.accounting_date,d.total_amount,r.accounting_date AS reversed_on
    FROM finance.trade_documents t
    JOIN finance.business_documents d ON d.organization_id=t.organization_id AND d.id=t.document_id
    LEFT JOIN finance.business_documents r ON r.organization_id=d.organization_id AND r.reversal_of_document_id=d.id AND r.state='posted'
    WHERE t.organization_id=p_organization_id AND t.original_document_id=p_original_document_id
      AND d.document_type IN ('customer_credit','vendor_credit') AND d.state='posted'
      AND d.id IS DISTINCT FROM p_exclude_document_id
  ), line_events AS (
    SELECT l.original_line_id AS line_id,c.accounting_date AS effective_date,
      l.quantity AS quantity,l.net_amount AS net,l.tax_amount AS tax,l.gross_amount AS gross
    FROM credits c JOIN finance.document_lines l ON l.organization_id=p_organization_id AND l.document_id=c.id
    UNION ALL
    SELECT l.original_line_id,c.reversed_on,-l.quantity,-l.net_amount,-l.tax_amount,-l.gross_amount
    FROM credits c JOIN finance.document_lines l ON l.organization_id=p_organization_id AND l.document_id=c.id
    WHERE c.reversed_on IS NOT NULL
    UNION ALL SELECT o.id,p_accounting_date,0,0,0,0 FROM originals o
  ), daily_lines AS (
    SELECT e.line_id,e.effective_date,sum(e.quantity) AS quantity,sum(e.net) AS net,sum(e.tax) AS tax,sum(e.gross) AS gross
    FROM line_events e GROUP BY e.line_id,e.effective_date
  ), running_lines AS (
    SELECT e.line_id,e.effective_date,
      sum(e.quantity) OVER w AS quantity,sum(e.net) OVER w AS net,sum(e.tax) OVER w AS tax,sum(e.gross) OVER w AS gross
    FROM daily_lines e WINDOW w AS (PARTITION BY e.line_id ORDER BY e.effective_date ROWS UNBOUNDED PRECEDING)
  ), peaks AS (
    SELECT e.line_id,max(e.quantity) AS quantity,max(e.net) AS net,max(e.tax) AS tax,max(e.gross) AS gross
    FROM running_lines e WHERE e.effective_date>=p_accounting_date GROUP BY e.line_id
  ), header_events AS (
    SELECT c.accounting_date AS effective_date,c.total_amount AS amount FROM credits c
    UNION ALL SELECT c.reversed_on,-c.total_amount FROM credits c WHERE c.reversed_on IS NOT NULL
    UNION ALL SELECT p_accounting_date,0
  ), daily_headers AS (
    SELECT e.effective_date,sum(e.amount) AS amount FROM header_events e GROUP BY e.effective_date
  ), running_headers AS (
    SELECT e.effective_date,sum(e.amount) OVER (ORDER BY e.effective_date ROWS UNBOUNDED PRECEDING) AS amount FROM daily_headers e
  ), header_peak AS (
    SELECT max(e.amount) AS amount FROM running_headers e WHERE e.effective_date>=p_accounting_date
  )
  SELECT o.id,GREATEST(0,o.quantity-COALESCE(p.quantity,0))::numeric(20,6),
    GREATEST(0,o.net_amount-COALESCE(p.net,0))::numeric(20,2),GREATEST(0,o.tax_amount-COALESCE(p.tax,0))::numeric(20,2),
    GREATEST(0,o.gross_amount-COALESCE(p.gross,0))::numeric(20,2),GREATEST(0,d.total_amount-COALESCE(h.amount,0))::numeric(20,2)
  FROM originals o JOIN finance.business_documents d ON d.organization_id=p_organization_id AND d.id=o.document_id
  LEFT JOIN peaks p ON p.line_id=o.id CROSS JOIN header_peak h;
$$;
REVOKE ALL ON FUNCTION finance_private.credit_remaining_capacity(uuid,uuid,date,uuid) FROM PUBLIC,ams_runtime;

CREATE FUNCTION finance_private.assert_credit_note_capacity(p_organization_id uuid,p_document_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_document finance.business_documents%ROWTYPE; v_original finance.business_documents%ROWTYPE;
  v_original_id uuid; v_original_recognition text; v_total_capacity numeric;
BEGIN
  SELECT * INTO v_document FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'credit document unavailable' USING ERRCODE='P0002'; END IF;
  IF v_document.document_type NOT IN ('customer_credit','vendor_credit') THEN RETURN; END IF;
  SELECT t.original_document_id INTO v_original_id FROM finance.trade_documents t
    WHERE t.organization_id=p_organization_id AND t.document_id=p_document_id;
  -- All credits for this original serialize here. Public callers have already
  -- locked organization/year/period and their own source before this parent row.
  SELECT * INTO v_original FROM finance.business_documents d
    WHERE d.organization_id=p_organization_id AND d.id=v_original_id FOR UPDATE;
  IF NOT FOUND OR v_original.state<>'posted' OR v_original.party_id IS DISTINCT FROM v_document.party_id
    OR v_original.accounting_date>v_document.accounting_date
    OR (v_document.document_type='customer_credit' AND v_original.document_type<>'invoice')
    OR (v_document.document_type='vendor_credit' AND v_original.document_type<>'bill')
    OR NOT EXISTS(SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=v_document.party_id AND c.is_active
      AND ((v_document.document_type='customer_credit' AND c.is_customer) OR (v_document.document_type='vendor_credit' AND c.is_vendor)))
    OR EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=p_organization_id
      AND r.reversal_of_document_id=v_original.id AND r.state='posted') THEN
    RAISE EXCEPTION 'credit original is reversed, future-dated, or incompatible' USING ERRCODE='23514';
  END IF;
  SELECT t.recognition_mode INTO v_original_recognition FROM finance.trade_documents t
    WHERE t.organization_id=p_organization_id AND t.document_id=v_original.id;
  IF v_document.document_type='customer_credit' AND v_original_recognition='deferred_revenue' THEN
    RAISE EXCEPTION 'deferred-revenue credits require a separately allocated earned/unearned basis' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id)
    OR EXISTS(SELECT 1 FROM finance.document_lines l LEFT JOIN finance.document_lines o
      ON o.organization_id=l.organization_id AND o.id=l.original_line_id AND o.document_id=v_original.id
      WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id AND (o.id IS NULL OR
        (l.account_id,l.cost_center_id,l.tax_code_id,l.tax_label_snapshot,l.tax_rate_snapshot,l.tax_mode,l.tax_recoverability_snapshot,l.tax_account_id)
        IS DISTINCT FROM (o.account_id,o.cost_center_id,o.tax_code_id,o.tax_label_snapshot,o.tax_rate_snapshot,o.tax_mode,o.tax_recoverability_snapshot,o.tax_account_id))) THEN
    RAISE EXCEPTION 'credit lines must preserve the selected original accounting and tax snapshots' USING ERRCODE='23514';
  END IF;
  -- Re-read committed capacity after acquiring the original lock. Duplicate
  -- original-line references within this one document are compared as a sum.
  IF EXISTS(
    SELECT 1 FROM finance_private.credit_remaining_capacity(p_organization_id,v_original.id,v_document.accounting_date,p_document_id) c
    JOIN (SELECT l.original_line_id,sum(l.quantity) AS quantity,sum(l.net_amount) AS net,sum(l.tax_amount) AS tax,sum(l.gross_amount) AS gross
      FROM finance.document_lines l WHERE l.organization_id=p_organization_id AND l.document_id=p_document_id GROUP BY l.original_line_id) proposed
      ON proposed.original_line_id=c.original_line_id
    WHERE proposed.quantity>c.remaining_quantity OR proposed.net>c.remaining_net_amount
      OR proposed.tax>c.remaining_tax_amount OR proposed.gross>c.remaining_gross_amount
  ) THEN RAISE EXCEPTION 'credit lines exceed remaining original quantity or amount' USING ERRCODE='23514'; END IF;
  SELECT min(c.remaining_total_amount) INTO v_total_capacity
    FROM finance_private.credit_remaining_capacity(p_organization_id,v_original.id,v_document.accounting_date,p_document_id) c;
  IF v_total_capacity IS NULL OR v_document.total_amount>v_total_capacity THEN
    RAISE EXCEPTION 'credit total including rounding exceeds remaining original total' USING ERRCODE='23514';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION finance_private.assert_credit_note_capacity(uuid,uuid) FROM PUBLIC,ams_runtime;

-- Add bounded guards to the existing commands, preserving their authorization,
-- approval, period locks, accounting, idempotency and audit implementation.
-- Save validates after every line and total is final, before its success receipt.
-- Posting validates before open-item/number locks and any accounting effects.
DO $patch$
DECLARE v_signature regprocedure; v_definition text; v_old text; v_new text;
BEGIN
  FOR v_signature,v_old,v_new IN SELECT * FROM (VALUES
    ('public.save_financial_document(uuid,uuid,integer,text,text,text,jsonb)'::regprocedure,
      $needle$  SELECT jsonb_build_object('document_id',d.id,'document_version',d.version,'state',d.state,'net_amount',d.net_amount::text,$needle$,
      $replacement$  IF v_type IN ('customer_credit','vendor_credit') THEN
    PERFORM finance_private.assert_credit_note_capacity(p_organization_id,v_id);
  END IF;
  SELECT jsonb_build_object('document_id',d.id,'document_version',d.version,'state',d.state,'net_amount',d.net_amount::text,$replacement$),
    ('public.post_financial_document(uuid,uuid,integer,text,text,text)'::regprocedure,
      $needle$  SELECT m.account_id INTO v_ar FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id$needle$,
      $replacement$  IF v_type IN ('customer_credit','vendor_credit') THEN
    PERFORM finance_private.assert_credit_note_capacity(p_organization_id,p_document_id);
  END IF;
  SELECT m.account_id INTO v_ar FROM finance.account_mappings m JOIN finance.accounts a ON a.organization_id=m.organization_id AND a.id=m.account_id$replacement$)
  ) AS patches(signature,old_text,new_text)
  LOOP
    v_definition:=pg_catalog.pg_get_functiondef(v_signature);
    IF position(v_old IN v_definition)=0 OR length(v_definition)-length(replace(v_definition,v_old,''))<>length(v_old) THEN
      RAISE EXCEPTION 'expected a single credit validation insertion point in %',v_signature;
    END IF;
    EXECUTE replace(v_definition,v_old,v_new);
  END LOOP;
END;
$patch$;

CREATE FUNCTION public.read_credit_note_options(
  p_organization_id uuid,p_document_type text,p_accounting_date date,
  p_party_id uuid DEFAULT NULL,p_original_document_id uuid DEFAULT NULL,p_search text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_original_type finance.document_type; v_sources jsonb; v_selected jsonb; v_lines jsonb;
  v_has_more boolean; v_original finance.business_documents%ROWTYPE; v_recognition text; v_remaining_total numeric;
BEGIN
  IF p_document_type IS NULL OR p_document_type NOT IN ('customer_credit','vendor_credit') OR p_accounting_date IS NULL
    OR NOT isfinite(p_accounting_date) OR length(COALESCE(p_search,''))>100 THEN
    RAISE EXCEPTION 'invalid credit source filters' USING ERRCODE='22023';
  END IF;
  PERFORM finance_private.require_capability(p_organization_id,CASE WHEN p_document_type='customer_credit' THEN 'sales.read' ELSE 'purchases.read' END);
  v_original_type:=CASE WHEN p_document_type='customer_credit' THEN 'invoice'::finance.document_type ELSE 'bill'::finance.document_type END;
  IF p_party_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM finance.contacts c WHERE c.organization_id=p_organization_id AND c.id=p_party_id) THEN
    RAISE EXCEPTION 'credit party unavailable' USING ERRCODE='P0002';
  END IF;
  WITH source_rows AS NOT MATERIALIZED (
    SELECT d.id,d.accounting_date,d.document_number,d.external_reference,t.supplier_invoice_key,
      COALESCE(NULLIF(d.party_snapshot->>'display_name',''),NULLIF(d.party_snapshot->>'legal_name',''),'Unnamed party') AS party_name,
      jsonb_build_object('id',d.id,'document_number',d.document_number,'party_id',d.party_id,
        'party_name',COALESCE(NULLIF(d.party_snapshot->>'display_name',''),NULLIF(d.party_snapshot->>'legal_name',''),'Unnamed party'),
        'issue_date',d.issue_date,'accounting_date',d.accounting_date,'supplier_reference',t.supplier_invoice_key,'total_amount',d.total_amount::text,
        'eligible',reason.message IS NULL,'blocked_reason',reason.message) AS summary
    FROM finance.business_documents d
    JOIN finance.trade_documents t ON t.organization_id=d.organization_id AND t.document_id=d.id
    JOIN finance.contacts c ON c.organization_id=d.organization_id AND c.id=d.party_id
    CROSS JOIN LATERAL (SELECT CASE
      WHEN EXISTS(SELECT 1 FROM finance.business_documents r WHERE r.organization_id=d.organization_id AND r.reversal_of_document_id=d.id AND r.state='posted') THEN 'This original document has been reversed.'
      WHEN d.accounting_date>p_accounting_date THEN 'Choose a credit accounting date on or after the original document.'
      WHEN NOT c.is_active THEN 'The original customer or supplier is inactive.'
      WHEN (p_document_type='customer_credit' AND NOT c.is_customer) OR (p_document_type='vendor_credit' AND NOT c.is_vendor) THEN 'The original party does not have the required customer or supplier role.'
      WHEN p_document_type='customer_credit' AND t.recognition_mode='deferred_revenue' THEN 'Deferred revenue requires a separately reviewed earned/unearned correction.'
      ELSE NULL END AS message) reason
    WHERE d.organization_id=p_organization_id AND d.document_type=v_original_type AND d.state='posted'
      AND (p_party_id IS NULL OR d.party_id=p_party_id) AND finance_private.can_read_document(p_organization_id,d.id)
  ), page AS (
    SELECT s.* FROM source_rows s WHERE p_search IS NULL OR btrim(p_search)='' OR
      concat_ws(' ',s.document_number,s.external_reference,s.supplier_invoice_key,s.party_name) ILIKE '%'||btrim(p_search)||'%'
    ORDER BY s.accounting_date DESC,s.id DESC LIMIT 101
  ), ordered_page AS (
    SELECT p.*,row_number() OVER (ORDER BY p.accounting_date DESC,p.id DESC) AS position FROM page p
  )
  SELECT COALESCE(jsonb_agg(p.summary ORDER BY p.accounting_date DESC,p.id DESC) FILTER (WHERE p.position<=100),'[]'::jsonb),
    count(*)>100,(SELECT s.summary FROM source_rows s WHERE s.id=p_original_document_id)
    INTO v_sources,v_has_more,v_selected FROM ordered_page p;
  IF p_original_document_id IS NOT NULL THEN
    IF v_selected IS NULL THEN RAISE EXCEPTION 'original credit source unavailable' USING ERRCODE='P0002'; END IF;
    SELECT d.* INTO v_original FROM finance.business_documents d WHERE d.organization_id=p_organization_id AND d.id=p_original_document_id;
    SELECT t.recognition_mode INTO v_recognition FROM finance.trade_documents t WHERE t.organization_id=p_organization_id AND t.document_id=p_original_document_id;
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'id',l.id,'line_no',l.line_no,'description',l.description,'item_id',l.item_id,'account_id',l.account_id,'account_code',a.code,'account_name',a.name,
      'cost_center_id',l.cost_center_id,'cost_center_code',cc.code,'cost_center_name',cc.name,
      'quantity',l.quantity::text,'unit_price',l.unit_price::text,'discount_amount',l.discount_amount::text,
      'net_amount',l.net_amount::text,'tax_amount',l.tax_amount::text,'gross_amount',l.gross_amount::text,
      'tax_code_id',l.tax_code_id,'tax_label_snapshot',l.tax_label_snapshot,'tax_rate_snapshot',l.tax_rate_snapshot::text,
      'tax_mode',l.tax_mode,'tax_recoverability_snapshot',l.tax_recoverability_snapshot,'tax_account_id',l.tax_account_id,
      'remaining_quantity',capacity.remaining_quantity::text,'remaining_net_amount',capacity.remaining_net_amount::text,
      'remaining_tax_amount',capacity.remaining_tax_amount::text,'remaining_gross_amount',capacity.remaining_gross_amount::text,
      'eligible',reason.message IS NULL,'blocked_reason',reason.message
    ) ORDER BY l.line_no),'[]'::jsonb),min(capacity.remaining_total_amount) INTO v_lines,v_remaining_total
    FROM finance.document_lines l
    JOIN finance_private.credit_remaining_capacity(p_organization_id,p_original_document_id,p_accounting_date,NULL) capacity ON capacity.original_line_id=l.id
    JOIN finance.accounts a ON a.organization_id=l.organization_id AND a.id=l.account_id
    LEFT JOIN finance.cost_centers cc ON cc.organization_id=l.organization_id AND cc.id=l.cost_center_id
    LEFT JOIN finance.items item ON item.organization_id=l.organization_id AND item.id=l.item_id
    LEFT JOIN finance.accounts tax_account ON tax_account.organization_id=l.organization_id AND tax_account.id=l.tax_account_id
    CROSS JOIN LATERAL (SELECT CASE
      WHEN capacity.remaining_quantity<=0 OR capacity.remaining_gross_amount<=0 THEN 'No remaining quantity or amount is available for this original line.'
      WHEN NOT a.is_active OR NOT a.is_postable THEN 'The original account is inactive or cannot receive postings.'
      WHEN cc.id IS NOT NULL AND NOT cc.is_active THEN 'The original cost center is inactive.'
      WHEN item.id IS NOT NULL AND NOT item.is_active THEN 'The original catalogue item is inactive.'
      WHEN tax_account.id IS NOT NULL AND (NOT tax_account.is_active OR NOT tax_account.is_postable) THEN 'The original tax account is inactive or cannot receive postings.'
      ELSE NULL END AS message) reason
    WHERE l.organization_id=p_organization_id AND l.document_id=p_original_document_id;
    v_selected:=v_selected||jsonb_build_object('party_snapshot',v_original.party_snapshot,'recognition_mode',v_recognition,
      'remaining_total_amount',COALESCE(v_remaining_total,0)::numeric(20,2)::text,'lines',v_lines);
    IF (v_selected->>'eligible')::boolean AND (COALESCE(v_remaining_total,0)<=0 OR NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v_lines) line WHERE (line->>'eligible')::boolean)) THEN
      v_selected:=v_selected||jsonb_build_object('eligible',false,'blocked_reason','No original lines are currently eligible; review their limits and account status.');
    END IF;
  END IF;
  RETURN jsonb_build_object('organization_id',p_organization_id,'document_type',p_document_type,'accounting_date',p_accounting_date,
    'sources',v_sources,'selected_source',v_selected,'has_more',v_has_more);
END;
$$;
REVOKE ALL ON FUNCTION public.read_credit_note_options(uuid,text,date,uuid,uuid,text) FROM PUBLIC,ams_runtime;
GRANT EXECUTE ON FUNCTION public.read_credit_note_options(uuid,text,date,uuid,uuid,text) TO ams_runtime;
