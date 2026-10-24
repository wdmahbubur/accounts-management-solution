"use client";
import {createContext,useContext,type ReactNode} from 'react';
import {parseBaseCurrency,type BaseCurrency} from '@ams/contracts';
const CurrencyContext=createContext<BaseCurrency|null>(null);
const TodayContext=createContext<string|null>(null);
export function CompanyCurrencyProvider({currency,today,children}:{currency:BaseCurrency;today:string;children:ReactNode}){
 return <CurrencyContext.Provider value={parseBaseCurrency(currency)}><TodayContext.Provider value={today}>{children}</TodayContext.Provider></CurrencyContext.Provider>;
}
export function useCompanyCurrency():BaseCurrency{
 const currency=useContext(CurrencyContext);if(!currency)throw new Error('Company currency is unavailable. Reopen the company.');return currency;
}
export function CompanyCurrency(){const currency=useContext(CurrencyContext);return <>{currency??'Company currency'}</>;}
export function useCompanyToday():string{const today=useContext(TodayContext);if(!today)throw new Error('Company calendar is unavailable. Reopen the company.');return today;}
