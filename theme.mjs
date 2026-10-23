const key = 'karaoke.theme.v1';
const picker = document.getElementById('theme-select');
function applyTheme(value) {
  const theme = value === 'warm' ? 'warm' : 'current';
  document.documentElement.dataset.theme = theme;
  picker.value = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'warm' ? '#120f16' : '#070b15';
  window.dispatchEvent(new Event('karaoke-theme-change'));
}
let saved;
try { saved = localStorage.getItem(key); } catch { /* Private browser settings can block storage. */ }
applyTheme(saved);
picker.addEventListener('change', () => {
  applyTheme(picker.value);
  try { localStorage.setItem(key, picker.value); } catch { /* Theme still works for this visit. */ }
});

// Decorative motion never reads audio or starts an audio context.
const motionPicker = document.getElementById('motion-toggle');
if (motionPicker) {
  const motionKey = 'karaoke.motion.v1';
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let motion = true;
  try { motion = localStorage.getItem(motionKey) !== 'off'; } catch {}
  function applyMotion() {
    const enabled = motion && !reducedMotion.matches;
    document.documentElement.dataset.motion = enabled && !document.hidden ? 'on' : 'off';
    motionPicker.setAttribute('aria-pressed', String(enabled));
    motionPicker.disabled = reducedMotion.matches;
    motionPicker.textContent = enabled ? '律動：開啟' : '律動：關閉';
    motionPicker.title = reducedMotion.matches ? '裝置已設定減少動態效果。' : '開啟或關閉介面裝飾動畫';
  }
  motionPicker.addEventListener('click', () => {
    motion = !motion;
    try { localStorage.setItem(motionKey, motion ? 'on' : 'off'); } catch {}
    applyMotion();
  });
  reducedMotion.addEventListener('change', applyMotion);
  document.addEventListener('visibilitychange', applyMotion);
  const intro = document.querySelector('.studio-intro');
  if (intro && 'IntersectionObserver' in window) {
    new IntersectionObserver(entries => {
      intro.classList.toggle('motion-visible', entries[0].isIntersecting);
    }).observe(intro);
  }
  applyMotion();
}
