/* Local artwork shared by the game menu, nursery stage and phone controller. */
window.NurseryArt = Object.freeze({
  escape(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  },
  baby(type = 'boy', pose = 'crawl') {
    const girl = type === 'girl';
    const state = pose === 'cheer' ? 'cheer' : pose === 'cry' ? 'cry' : '';
    const emotion = state === 'cheer' ? ', радуется с погремушкой' : state === 'cry' ? ', плачет' : '';
    return `<span class="baby-sprite ${girl ? 'girl' : 'boy'} ${state}" role="img" aria-label="${girl ? 'Малышка' : 'Малыш'}${emotion}"></span>`;
  },
  toy(kind, pink = false) {
    const color = pink ? '#d97591' : '#3f9daf';
    const frame = content => `<svg viewBox="0 0 120 120" aria-hidden="true" fill="none" xmlns="http://www.w3.org/2000/svg"><g stroke="#805b4e" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round">${content}</g></svg>`;
    if (kind === 'rattle') return frame(`<g transform="rotate(30 60 60)"><rect x="50" y="61" width="20" height="49" rx="9" fill="${color}"/><circle cx="60" cy="39" r="32" fill="${color}"/><circle cx="60" cy="39" r="25" stroke="#fff" stroke-opacity=".5"/><path d="m60 20 6 12 14 2-10 10 2 14-12-7-12 7 2-14-10-10 14-2Z" fill="#ffdf8d" stroke="none"/><path d="m78 17 2 4 5 1-4 3 1 4-4-2-4 2 1-4-3-3 4-1Z" fill="#fff6df" stroke="none"/></g>`);
    if (kind === 'blocks') return frame(`<rect x="43" y="7" width="42" height="42" rx="6" fill="#7dbcc7" transform="rotate(-7 64 28)"/><rect x="14" y="54" width="43" height="43" rx="6" fill="#e990ac" transform="rotate(8 35 75)"/><rect x="64" y="52" width="43" height="43" rx="6" fill="#f1ce72" transform="rotate(-5 85 73)"/><g stroke="#fff8e8" stroke-width="4"><path d="m53 36 9-22 11 21m-16-8 12-1M29 63v23h8c12 0 12-11 0-11 10 0 10-12 0-12h-8ZM94 61c-20-8-23 26-1 20"/></g>`);
    if (kind === 'car') return frame('<path d="M17 60h10l9-27h39l17 27h11c7 0 10 8 10 16v13H11V72c0-7 1-12 6-12Z" fill="#d77d7c"/><path d="m40 39-7 22h20V39Zm20 0v22h23L71 39Z" fill="#fff4dc"/><circle cx="34" cy="88" r="15" fill="#77b1bb"/><circle cx="89" cy="88" r="15" fill="#77b1bb"/><circle cx="34" cy="88" r="5" fill="#fff5e4"/><circle cx="89" cy="88" r="5" fill="#fff5e4"/>');
    if (kind === 'duck') return frame('<path d="M37 53c-28 0-29 39-2 46 24 7 60-1 67-27-14 5-26 2-31-8 17-28 0-50-18-48-22 1-28 24-16 37Z" fill="#f6d477"/><path d="m33 39-22 7 22 8" fill="#de9470"/><circle cx="48" cy="33" r="3" fill="#805b4e"/><path d="M47 72c14-12 30 1 20 12-10 9-21 3-20-12Z" fill="#edbd55"/>');
    return frame('<ellipse cx="62" cy="51" rx="28" ry="32" fill="#f5d484"/><path d="M57 40c-17 8-10 31 4 32" stroke="#fff5dc" stroke-width="6"/><ellipse cx="62" cy="72" rx="37" ry="15" fill="#87c7bd"/><circle cx="63" cy="93" r="20" stroke="#59a69c" stroke-width="8"/>');
  }
});
