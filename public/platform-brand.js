// Platform branding is independent of the individual games.
window.PlatformBrand = Object.freeze({name:'ШумParty',babyName:'Ползунки наперегонки',babyFirstLine:'Ползунки',babySecondLine:'наперегонки'});
document.addEventListener('DOMContentLoaded', () => {
  const b = PlatformBrand;
  for(const [selector,value] of [['[data-platform-name]',b.name],['[data-baby-name]',b.babyName],['[data-baby-first]',b.babyFirstLine],['[data-baby-second]',b.babySecondLine]]) document.querySelectorAll(selector).forEach(el=>{el.textContent=value});
  if(document.body.dataset.platformTitle)document.title=`${b.name} — ${document.body.dataset.platformTitle}`;
  if(document.body.dataset.babyTitle)document.title=`${b.babyName} — ${b.name}`;
});
