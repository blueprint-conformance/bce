// Native controls and poster fallback work without scripting. With scripting,
// a clear play action keeps idle players from showing an empty loading control.
const videos=[...document.querySelectorAll('.film-feature video,.film-library video')];
for(const video of videos){
  const button=document.createElement('button');button.type='button';button.className='film-start';button.textContent='Play film';button.setAttribute('aria-label','Play '+video.getAttribute('aria-label'));video.parentElement.append(button);video.controls=false;
  button.addEventListener('click',async()=>{video.controls=true;button.disabled=true;button.textContent='Loading film…';try{await video.play();button.remove();}catch{button.disabled=false;button.textContent='Try playback again';video.closest('.film-entry')?.setAttribute('data-media-error','true');}});
  video.addEventListener('play',()=>{button.remove();video.controls=true;for(const other of videos)if(other!==video)other.pause();});
  video.addEventListener('error',()=>{video.controls=true;video.closest('.film-entry')?.setAttribute('data-media-error','true');});
}
document.addEventListener('visibilitychange',()=>{if(document.hidden)videos.forEach(video=>video.pause());});
if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{for(const entry of entries)if(!entry.isIntersecting)entry.target.pause();},{threshold:.05});videos.forEach(video=>observer.observe(video));}
