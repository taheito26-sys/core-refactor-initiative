# AI Development Rules & Tech Stack

## Tech Stack Overview
- **Framework**: React 18 with Vite and TypeScript for a high-performance, type-safe frontend.
- **Backend-as-a-Service**: Supabase for Authentication, PostgreSQL database, Realtime subscriptions, and Edge Functions.
- **Styling**: Tailwind CSS for utility-first styling, following the project's custom "Tracker" design system.
- **UI Components**: Shadcn UI (built on Radix UI primitives) for accessible, unstyled components.
- **State Management**: Zustand for complex global state (Chat, WebRTC) and React Context for simpler app-wide state (Auth, Theme).
- **Data Fetching**: TanStack Query (React Query) v5 for server state management, caching, and synchronization.
- **Routing**: React Router DOM v6 for client-side navigation.
- **Native Bridge**: Capacitor for wrapping the web app into native Android and iOS applications.
- **Icons & Utilities**: Lucide React for iconography and date-fns for date manipulation.

## Library Usage Rules

### 1. UI & Styling
- **Shadcn UI**: Always check `src/components/ui` before creating a new primitive component. Use these as the foundation for all UI elements.
- **Tailwind CSS**: Use utility classes for all layout and spacing. Avoid writing custom CSS unless it's for complex animations or variables in `index.css`.
- **Responsive Design**: Use Tailwind's responsive prefixes (`sm:`, `md:`, `lg:`, `xl:`) to ensure mobile-first compatibility.

### 2. Data & State
- **React Query**: Use for all asynchronous data fetching from Supabase. Do not store server data in Zustand or local state if it can be managed by a query.
- **Zustand**: Reserved for high-frequency or complex client-side state, such as chat UI state, active call sessions, or multi-step form progress.
- **Supabase Client**: Use the singleton client from `@/integrations/supabase/client`.

### 3. Forms & Validation
- **React Hook Form**: Use for all forms to manage state and submission.
- **Zod**: Use for schema validation, both for form inputs and for validating API/Database responses where type safety is critical.

### 4. Communication & Feedback
- **Sonner**: Use `toast` from `sonner` for non-intrusive user notifications (success, error, info).
- **Lucide React**: Use for all icons to maintain a consistent visual language.

### 5. Platform Specifics
- **Platform Helpers**: Use `src/platform/runtime.ts` to detect if the app is running on Web, Android, or iOS before using native-only features.
- **Deep Linking**: Follow the patterns in `src/lib/notification-router.ts` for handling deep links from notifications.

### 6. Internationalization (i18n)
- **useT Hook**: Always use the `useT` hook from `@/lib/i18n` for user-facing strings to support English and Arabic (RTL).