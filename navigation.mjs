// Bookmarks only change page position; they never touch playback or the current take.
const nav = document.querySelector('.section-nav');
const menus = [...nav.querySelectorAll('.nav-menu')];
function closeMenus(except) {
  for (const menu of menus) if (menu !== except) menu.open = false;
}
for (const menu of menus) {
  menu.querySelector('summary').addEventListener('click', () => {
    if (!menu.open) closeMenus(menu);
  });
  menu.addEventListener('toggle', () => {
    if (menu.open) closeMenus(menu);
  });
}
document.addEventListener('click', event => {
  if (!nav.contains(event.target)) closeMenus();
});
nav.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  const openMenu = menus.find(menu => menu.open);
  if (!openMenu) return;
  closeMenus();
  openMenu.querySelector('summary').focus();
  event.preventDefault();
});
// The sticky bar wraps on small screens; anchors must clear its actual height.
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--nav-offset', `${nav.offsetHeight + 16}px`);
}).observe(nav);
function visit(hash) {
  if (!hash.startsWith('#')) return;
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  closeMenus();
  for (const link of nav.querySelectorAll('a[href^="#"]')) {
    if (link.hash === hash) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  }
  for (const menu of menus) menu.classList.toggle('has-current', !!menu.querySelector('[aria-current]'));
  for (let node = target; node; node = node.parentElement) {
    if (node instanceof HTMLDetailsElement) node.open = true;
  }
  if (!target.hasAttribute('tabindex')) target.tabIndex = -1;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}
nav.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || !link.hash || link.target === '_blank' || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.replaceState(null, '', link.hash);
  visit(link.hash);
});
window.addEventListener('hashchange', () => visit(location.hash));
if (location.hash) requestAnimationFrame(() => visit(location.hash));
