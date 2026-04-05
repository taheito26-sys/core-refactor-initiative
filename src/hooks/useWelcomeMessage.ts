import { useEffect, useRef } from 'react';
import { toast } from 'sonner';

// ─── Message pools ────────────────────────────────────────────────────────────

const MESSAGES_EN = [
  { title: '👋 Hey {name}!',            body: "Your trades missed you. No seriously, they were asking about you 📊" },
  { title: '🚀 {name} has entered the chat!', body: "Markets are waiting. Coffee optional, hustle mandatory ☕💸" },
  { title: '💰 Oh look who\'s back — {name}!', body: "The profits won't count themselves. Let's get to work 🔥" },
  { title: '🎯 {name}, you\'re back!',    body: "The charts were getting lonely without you 📈" },
  { title: '⚡ {name} is online!',        body: "Time to turn those numbers green 💚" },
  { title: '🌟 Welcome back, {name}!',   body: "Another day, another opportunity to outperform 🏆" },
  { title: '🤑 {name} reporting for duty!', body: "USDT won't trade itself — you've got this 💪" },
  { title: '👑 The boss is back — {name}!', body: "Everything was on pause until you arrived 😤" },
  { title: '🎉 {name} is in the house!', body: "Let's stack those QARs and keep the streak alive 🔥" },
  { title: '🦁 {name} is back!',          body: "Every great trade starts with showing up. You showed up ✅" },
  { title: '📊 Welcome, {name}!',         body: "Your portfolio has been patiently waiting for your genius 🧠" },
  { title: '🌙 Good to see you, {name}!', body: "Whether it's early or late — good traders never really clock out 🕐" },
  { title: '💎 {name} is in!',            body: "Diamond hands, clear mind, let's do this 🤝" },
  { title: '🎮 Player {name} has joined!', body: "Achievement unlocked: showed up again 🏅" },
  { title: '🌊 {name} rides again!',      body: "Catch the wave before it catches you 🏄‍♂️" },
  { title: '🔑 {name} unlocked the app!', body: "Now go unlock some profits too 💼" },
  { title: '☀️ Rise and grind, {name}!', body: "The market doesn't care about your alarm clock ⏰" },
  { title: '🧠 Big brain {name} is here!', body: "Every session is a chance to be smarter than yesterday 💡" },
  { title: '🎸 {name} rocks!',            body: "Let's make this session legendary 🌟" },
  { title: '🦅 {name} is soaring in!',   body: "High altitude thinking, ground-level execution. Let's go 🚁" },
];

const MESSAGES_AR = [
  { title: '👋 يا هلا {name}!',          body: 'صفقاتك كانت تسأل عنك بالجد 📊' },
  { title: '🚀 {name} وصل أخيراً!',      body: 'الأسواق في انتظارك، القهوة اختيارية والطموح إلزامي ☕💸' },
  { title: '💰 آه من {name}، رجع!',       body: 'الأرباح ما تحسب حالها، يالله نشتغل 🔥' },
  { title: '🎯 {name} عاد!',              body: 'الشارتات كانت وحيدة بدونك 📈' },
  { title: '⚡ {name} أون لاين!',         body: 'وقت نحول الأرقام للأخضر 💚' },
  { title: '🌟 أهلاً وسهلاً {name}!',    body: 'يوم جديد وفرصة جديدة تتفوق فيها 🏆' },
  { title: '🤑 {name} جاهز للعمل!',      body: 'الـ USDT ما يتداول لحاله — انت الي تقدر 💪' },
  { title: '👑 الرئيس رجع — {name}!',    body: 'كل شيء كان موقوف لحد ما وصلت 😤' },
  { title: '🎉 {name} في البيت!',         body: 'يالله نكدس الريال ونحافظ على السلسلة 🔥' },
  { title: '🦁 {name} رجع!',              body: 'كل صفقة عظيمة تبدأ بالحضور. أنت حضرت ✅' },
  { title: '📊 أهلاً {name}!',            body: 'محفظتك كانت تنتظر عبقريتك بصبر 🧠' },
  { title: '🌙 سعيدين بشوفتك {name}!',   body: 'سواء بكير أو متأخر، التجار الجيدين ما يوقفون 🕐' },
  { title: '💎 {name} دخل!',              body: 'يد ماسية، ذهن صافي، يالله 🤝' },
  { title: '🎮 اللاعب {name} انضم!',      body: 'إنجاز جديد: حضرت مرة ثانية 🏅' },
  { title: '🌊 {name} يعود!',             body: 'اركب الموجة قبل ما تركبك 🏄‍♂️' },
  { title: '🔑 {name} فتح التطبيق!',     body: 'الحين افتح الأرباح كمان 💼' },
  { title: '☀️ صحّي وتحدّي {name}!',     body: 'السوق ما يهتم بالمنبه 😂⏰' },
  { title: '🧠 عبقرينا {name} وصل!',     body: 'كل جلسة فرصة تكون أذكى من أمس 💡' },
  { title: '🎸 {name} روك!',              body: 'خلّ هالجلسة تكون أسطورية 🌟' },
  { title: '🦅 {name} حلّق!',             body: 'تفكير عالي، تنفيذ دقيق. يالله 🚁' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SESSION_KEY = 'wlcm_shown';          // sessionStorage: shown this tab session
const LAST_HIDDEN_KEY = 'wlcm_hidden_at';  // localStorage:  timestamp when page was hidden
const BACK_THRESHOLD_MS = 20 * 60 * 1000; // 20 min away → show welcome again

function pickMessage(name: string, lang: 'en' | 'ar'): { title: string; body: string } {
  const pool = lang === 'ar' ? MESSAGES_AR : MESSAGES_EN;
  // Use a rotating seed so consecutive opens get different messages
  const seed = Number(localStorage.getItem('wlcm_seed') || '0');
  const idx = seed % pool.length;
  localStorage.setItem('wlcm_seed', String((seed + 1) % pool.length));
  const msg = pool[idx];
  return {
    title: msg.title.replace('{name}', name),
    body:  msg.body,
  };
}

function showWelcome(name: string, lang: 'en' | 'ar') {
  const { title, body } = pickMessage(name, lang);
  toast(title, {
    description: body,
    duration: 6000,
    position: 'bottom-right',
  });
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useWelcomeMessage(name: string | null | undefined, lang: 'en' | 'ar') {
  const shownRef = useRef(false);

  useEffect(() => {
    if (!name) return; // wait until profile is loaded

    // 1) First open of this browser session (new tab, page reload, saved credentials)
    if (!sessionStorage.getItem(SESSION_KEY)) {
      sessionStorage.setItem(SESSION_KEY, '1');
      // Small delay so the app finishes rendering before the toast pops
      const t = setTimeout(() => showWelcome(name, lang), 800);
      shownRef.current = true;
      return () => clearTimeout(t);
    }
  }, [name, lang]);

  useEffect(() => {
    if (!name) return;

    // 2) Returning after being away — listen for visibility change
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        localStorage.setItem(LAST_HIDDEN_KEY, String(Date.now()));
        return;
      }
      // Page became visible
      const hiddenAt = Number(localStorage.getItem(LAST_HIDDEN_KEY) || '0');
      if (hiddenAt > 0 && Date.now() - hiddenAt >= BACK_THRESHOLD_MS) {
        localStorage.removeItem(LAST_HIDDEN_KEY);
        setTimeout(() => showWelcome(name, lang), 400);
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, [name, lang]);
}
