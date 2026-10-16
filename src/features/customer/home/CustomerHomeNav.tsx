<<<<<<< HEAD
import { Bell, House, Menu, MessageCircle, ShoppingCart, Wallet } from 'lucide-react';
import '@/styles/customer-home.css';

function HomeSolid() {
  return <svg viewBox="0 0 24 24" fill="currentColor"><path d="M10.6 2.8a2 2 0 0 1 2.8 0l8.100 6.900A2 2 0 0 1 22 11.200V20a2 2 0 0 1-2 2h-4.500v-6.500a1.500 1.500 0 0 0-1.500-1.500h-4a1.500 1.500 0 0 0-1.500 1.500V22H4a2 2 0 0 1-2-2v-8.800a2 2 0 0 1 .7-1.500l7.900-6.900Z" /></svg>;
}

/** The phone pages' bottom bar: Home, Orders, Cash, Notifications, Chat, More, matching PRIMARY_NAV in CustomerLayout. */
export function CustomerHomeNav({ lang, chatUnread, onNavigate, onMore, activeKey = 'home' }: {
  lang: 'en' | 'ar'; chatUnread: number; onNavigate: (path: string) => void; onMore: () => void;
  /** Which of home / orders / notifications / chat is the current page. */
  activeKey?: 'home' | 'orders' | 'cash' | 'notifications' | 'chat';
}) {
  const t = (en: string, ar: string) => (lang === 'ar' ? ar : en);
  const items = [
    { key: 'home', label: t('Home', 'الرئيسية'), icon: activeKey === 'home' ? <HomeSolid /> : <House strokeWidth={1.7} />, go: () => onNavigate('/c/home'), on: activeKey === 'home' },
    { key: 'orders', label: t('Orders', 'الطلبات'), icon: <ShoppingCart strokeWidth={1.7} />, go: () => onNavigate('/c/orders'), on: activeKey === 'orders' },
    { key: 'cash', label: t('Cash', 'النقد'), icon: <Wallet strokeWidth={1.7} />, go: () => onNavigate('/c/wallet'), on: activeKey === 'cash' },
    { key: 'notifications', label: t('Notifications', 'التنبيهات'), icon: <Bell strokeWidth={1.7} />, go: () => onNavigate('/c/notifications'), on: activeKey === 'notifications' },
    { key: 'chat', label: t('Chats', 'المحادثات'), icon: <MessageCircle strokeWidth={1.7} />, go: () => onNavigate('/c/chat'), badge: chatUnread, on: activeKey === 'chat' },
    { key: 'more', label: t('More', 'المزيد'), icon: <Menu strokeWidth={1.9} />, go: onMore },
  ];
  return (
    <nav className="ch-nav" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <div className="ch-nav-in">
        {items.map(i => (
          <button key={i.key} type="button" className={`ch-nav-item ${i.on ? 'on' : ''}`} onClick={i.go}>
            <span className="ch-nav-ic">{i.icon}</span>
            {i.badge ? <span className="ch-badge">{i.badge > 9 ? '9+' : i.badge}</span> : null}
            <span className="ch-nav-lbl">{i.label}</span>
            {i.on && <span className="ch-nav-bar" />}
          </button>
        ))}
      </div>
    </nav>
  );
}
