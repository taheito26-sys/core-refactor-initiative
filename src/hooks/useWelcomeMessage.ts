import { useEffect, useState, useCallback } from 'react';

// ─── Message pools ────────────────────────────────────────────────────────────

const MESSAGES_EN = [
  { emoji: '👋', title: 'Hey {name}!',                body: "Your trades missed you. No seriously, they were asking about you 📊" },
  { emoji: '🚀', title: '{name} has entered the chat!', body: "Markets are waiting. Coffee optional, hustle mandatory ☕💸" },
  { emoji: '💰', title: "Oh look who's back — {name}!", body: "The profits won't count themselves. Let's get to work 🔥" },
  { emoji: '🎯', title: "{name}, you're back!",         body: "The charts were getting lonely without you 📈" },
  { emoji: '⚡', title: '{name} is online!',            body: "Time to turn those numbers green 💚" },
  { emoji: '🌟', title: 'Welcome back, {name}!',        body: "Another day, another opportunity to outperform 🏆" },
  { emoji: '🤑', title: '{name} reporting for duty!',   body: "USDT won't trade itself — you've got this 💪" },
  { emoji: '👑', title: 'The boss is back — {name}!',   body: "Everything was on pause until you arrived 😤" },
  { emoji: '🎉', title: '{name} is in the house!',      body: "Let's stack those QARs and keep the streak alive 🔥" },
  { emoji: '🦁', title: '{name} is back!',              body: "Every great trade starts with showing up. You showed up ✅" },
  { emoji: '📊', title: 'Welcome, {name}!',             body: "Your portfolio has been patiently waiting for your genius 🧠" },
  { emoji: '🌙', title: 'Good to see you, {name}!',    body: "Whether it's early or late — good traders never really clock out 🕐" },
  { emoji: '💎', title: '{name} is in!',                body: "Diamond hands, clear mind, let's do this 🤝" },
  { emoji: '🎮', title: 'Player {name} has joined!',    body: "Achievement unlocked: showed up again 🏅" },
  { emoji: '🌊', title: '{name} rides again!',          body: "Catch the wave before it catches you 🏄‍♂️" },
  { emoji: '🔑', title: '{name} unlocked the app!',     body: "Now go unlock some profits too 💼" },
  { emoji: '☀️', title: 'Rise and grind, {name}!',     body: "The market doesn't care about your alarm clock ⏰" },
  { emoji: '🧠', title: 'Big brain {name} is here!',   body: "Every session is a chance to be smarter than yesterday 💡" },
  { emoji: '🎸', title: '{name} rocks!',                body: "Let's make this session legendary 🌟" },
  { emoji: '🦅', title: '{name} is soaring in!',       body: "High altitude thinking, ground-level execution. Let's go 🚁" },
];

const MESSAGES_AR = [
  { emoji: '👋', title: 'يا هلا {name}!',           body: 'صفقاتك كانت تسأل عنك بالجد 📊' },
  { emoji: '🚀', title: '{name} وصل أخيراً!',        body: 'الأسواق في انتظارك، القهوة اختيارية والطموح إلزامي ☕💸' },
  { emoji: '💰', title: 'آه من {name}، رجع!',         body: 'الأرباح ما تحسب حالها، يالله نشتغل 🔥' },
  { emoji: '🎯', title: '{name} عاد!',               body: 'الشارتات كانت وحيدة بدونك 📈' },
  { emoji: '⚡', title: '{name} أون لاين!',           body: 'وقت نحول الأرقام للأخضر 💚' },
  { emoji: '🌟', title: 'أهلاً وسهلاً {name}!',      body: 'يوم جديد وفرصة جديدة تتفوق فيها 🏆' },
  { emoji: '🤑', title: '{name} جاهز للعمل!',        body: 'الـ USDT ما يتداول لحاله — انت الي تقدر 💪' },
  { emoji: '👑', title: 'الرئيس رجع — {name}!',      body: 'كل شيء كان موقوف لحد ما وصلت 😤' },
  { emoji: '🎉', title: '{name} في البيت!',           body: 'يالله نكدس الريال ونحافظ على السلسلة 🔥' },
  { emoji: '🦁', title: '{name} رجع!',               body: 'كل صفقة عظيمة تبدأ بالحضور. أنت حضرت ✅' },
  { emoji: '📊', title: 'أهلاً {name}!',              body: 'محفظتك كانت تنتظر عبقريتك بصبر 🧠' },
  { emoji: '🌙', title: 'سعيدين بشوفتك {name}!',    body: 'سواء بكير أو متأخر، التجار الجيدين ما يوقفون 🕐' },
  { emoji: '💎', title: '{name} دخل!',               body: 'يد ماسية، ذهن صافي، يالله 🤝' },
  { emoji: '🎮', title: 'اللاعب {name} انضم!',       body: 'إنجاز جديد: حضرت مرة ثانية 🏅' },
  { emoji: '🌊', title: '{name} يعود!',              body: 'اركب الموجة قبل ما تركبك 🏄‍♂️' },
  { emoji: '🔑', title: '{name} فتح التطبيق!',       body: 'الحين افتح الأرباح كمان 💼' },
  { emoji: '☀️', title: 'صحّي وتحدّي {name}!',      body: 'السوق ما يهتم بالمنبه 😂⏰' },
  { emoji: '🧠', title: 'عبقرينا {name} وصل!',      body: 'كل جلسة فرصة تكون أذكى من أمس 💡' },
  { emoji: '🎸', title: '{name} روك!',               body: 'خلّ هالجلسة تكون أسطورية 🌟' },
  { emoji: '🦅', title: '{name} حلّق!',             body: 'تفكير عالي، تنفيذ دقيق. يالله 🚁' },
];

// ─── Public types ─────────────────────────────────────────────────────────────

export interface WelcomeMsg {
  emoji: string;
  title: string;
  body: string;
  isRTL: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_KEY    = 'wlcm_shown';
const LAST_HIDDEN_KEY = 'wlcm_hidden_at';
const BACK_THRESHOLD_MS = 20 * 60 * 1000;

function pickMessage(name: string, lang: 'en' | 'ar'): WelcomeMsg {
  const pool = lang === 'ar' ? MESSAGES_AR : MESSAGES_EN;
  const seed = Number(localStorage.getItem('wlcm_seed') || '0');
  const idx  = seed % pool.length;
  localStorage.setItem('wlcm_seed', String((seed + 1) % pool.length));
  const m = pool[idx];
  return {
    emoji: m.emoji,
    title: m.title.replace('{name}', name),
    body:  m.body,
    isRTL: lang === 'ar',
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWelcomeMessage(name: string | null | undefined, lang: 'en' | 'ar') {
  const [msg, setMsg] = useState<WelcomeMsg | null>(null);

  const dismiss = useCallback(() => setMsg(null), []);

  // Trigger 1 — first open of this browser session
  useEffect(() => {
    if (!name) return;
    if (sessionStorage.getItem(SESSION_KEY)) return;
    sessionStorage.setItem(SESSION_KEY, '1');
    const t = setTimeout(() => setMsg(pickMessage(name, lang)), 800);
    return () => clearTimeout(t);
  }, [name, lang]);

  // Trigger 2 — returning after 20 min away
  useEffect(() => {
    if (!name) return;
    const onVisChange = () => {
      if (document.visibilityState === 'hidden') {
        localStorage.setItem(LAST_HIDDEN_KEY, String(Date.now()));
        return;
      }
      const hiddenAt = Number(localStorage.getItem(LAST_HIDDEN_KEY) || '0');
      if (hiddenAt > 0 && Date.now() - hiddenAt >= BACK_THRESHOLD_MS) {
        localStorage.removeItem(LAST_HIDDEN_KEY);
        setTimeout(() => setMsg(pickMessage(name, lang)), 400);
      }
    };
    document.addEventListener('visibilitychange', onVisChange);
    return () => document.removeEventListener('visibilitychange', onVisChange);
  }, [name, lang]);

  return { msg, dismiss };
}
