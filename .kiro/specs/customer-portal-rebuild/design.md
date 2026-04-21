# Design Document: Customer Portal Rebuild

## Overview

The customer portal rebuild delivers a focused, four-page experience for P2P FX customers trading on the QAR→EGP corridor. The portal replaces the current fragmented pages (Home, Wallet, Orders) with a coherent information architecture: Dashboard, Orders, Cash Management, and Settings — each purpose-built to answer the customer's core question instantly: how much did I send, how much did I receive, and what rate did I get.

The rebuild is additive, not destructive. All existing Supabase data functions in `customer-portal.ts` and `customer-market.ts` are reused as-is. New derived-data hooks layer on top of `listCustomerOrders` to compute dashboard metrics client-side, avoiding new backend endpoints for the initial release. Cash Management introduces a new `cash_accounts` and `cash_movements` data model backed by Supabase.

The status vocabulary exposed to customers is simplified: internal statuses `payment_sent` → **Sent**, `completed` → **Accepted**. All intermediate statuses (`pending_quote`, `quoted`, `quote_accepted`, `awaiting_payment`, `quote_rejected`, `cancelled`) remain in the data layer but are either hidden or collapsed in the customer-facing UI.

## Architecture

```mermaid
graph TD
    subgraph Pages["Pages (src/pages/customer/)"]
        D[DashboardPage /c/home]
        O[OrdersPage /c/orders]
        C[CashPage /c/cash]
        S[SettingsPage /c/settings]
    end

    subgraph Hooks["Feature Hooks (src/features/customer/)"]
        DH[useDashboardSummary]
        OH[useCustomerOrders]
        CH[useCashAccounts]
        MH[useCustomerMarket]
    end

    subgraph DataLayer["Data Layer"]
        CP[customer-portal.ts\nlistCustomerOrders\norder mutations]
        CM[customer-market.ts\ngetQatarEgyptGuideRate]
        CA[cash-accounts.ts\nlistCashAccounts\nlistCashMovements]
        SB[(Supabase\nPostgreSQL + Realtime)]
    end

    subgraph State["State (Zustand + React Query)"]
        RQ[React Query Cache]
        ZS[Zustand UI Store]
    end

    D --> DH
    O --> OH
    C --> CH
    D --> MH

    DH --> CP
    OH --> CP
    CH --> CA
    MH --> CM

    CP --> SB
    CM --> SB
    CA --> SB

    DH --> RQ
    OH --> RQ
    CH --> RQ
    MH --> RQ
