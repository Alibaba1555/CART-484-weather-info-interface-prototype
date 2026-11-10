'use strict';
const $ = id => document.getElementById(id);
let data = null, busy = false, shownTemp = null;
const fmt = value => Number.isFinite(value) ? value.toFixed(1) : '—';
const stamp = seconds => new Date(seconds*1000).toLocaleString('fr-CA', {timeZone:'America/Toronto'});
function render() {
  if (!data) return;
  const c = data.current, f = data.forecast;
  $('source-status').textContent = (data.demo ? 'TEST · données simulées' : 'Station locale · BME680') + ' · Dernière mesure : ' + (c ? stamp(c.time) : 'aucune') + (data.stale ? ' · données anciennes ou indisponibles' : '') + (data.error ? ' · '+data.error : '');
  if (c && (shownTemp === null || Math.abs(c.temperature-shownTemp) > Number($('threshold').value))) shownTemp = c.temperature;
  $('temperature').textContent = fmt(shownTemp);
  $('humidity').textContent = fmt(c?.humidity);
  $('pressure').textContent = fmt(c ? c.pressure/10 : null);
  $('air-quality').textContent = c?.air_quality || 'Indisponible';
  $('gas-note').textContent = c?.gas != null ? 'Résistance du gaz : '+fmt(c.gas/1000)+' kilo-ohms · évaluation du capteur' : 'Aucune mesure disponible';
  $('general-summary').textContent = f.summary;
  $('trend').textContent = f.note + ' Fiabilité décroissante avec la durée.';
  $('forecast').replaceChildren();
  for (const p of f.hourly.slice(0,Number($('horizon').value))) {
    const a = document.createElement('article'); a.className='hour';
    const h=document.createElement('h3'); h.textContent=new Date(p.time*1000).toLocaleTimeString('fr-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit'});
    const v=document.createElement('strong'); v.textContent=fmt(p.temperature)+' °C';
    const pressure=document.createElement('p'); pressure.textContent=fmt(p.pressure)+' kPa';
    a.append(h,v,pressure); $('forecast').append(a);
  }
  $('outlook-title').textContent='Prévisions sur '+$('horizon').value+' heures';
  $('daily-forecast').replaceChildren();
  $('daily-note').textContent=f.daily.length ? 'Estimations expérimentales du cycle thermique · aucune prévision de pluie ou de nuages.' : (f.daily_note || 'Historique insuffisant pour une estimation sur trois jours.');
  for (const day of f.daily) {
    const a=document.createElement('article'); a.className='day';
    const h=document.createElement('h3'); h.textContent=new Date(day.date+'T12:00:00Z').toLocaleDateString('fr-CA',{timeZone:'America/Toronto',weekday:'long',day:'numeric',month:'long'});
    const p=document.createElement('p'); p.className='day-condition'; p.textContent=day.description;
    const v=document.createElement('p'); v.textContent='Minimum : '+fmt(day.min)+' degrés Celsius. Maximum : '+fmt(day.max)+' degrés Celsius.';
    const note=document.createElement('p'); note.textContent='Confiance : '+day.confidence.toLowerCase()+'.';
    a.append(h,p,v,note); $('daily-forecast').append(a);
  }
  $('clock').textContent=data.history.count+' mesures conservées · rétention : 365 jours.';
  $('decision').textContent='Seuil d’affichage de la température : '+$('threshold').value+' °C.';
}
async function refresh() {
  if(busy) return;
  busy=true; $('refresh').disabled=true;
  const controller=new AbortController(), timer=setTimeout(()=>controller.abort(),10000);
  try {
    const response=await fetch('/api/stats',{cache:'no-store',signal:controller.signal});
    if(!response.ok) throw new Error('HTTP '+response.status);
    data=await response.json(); render(); $('notice').textContent='';
  } catch {
    $('notice').textContent='Connexion à la station impossible. Ouvrez cette page depuis le serveur Python. Les valeurs déjà affichées peuvent être anciennes.';
  } finally {clearTimeout(timer); busy=false; $('refresh').disabled=false;}
}
$('refresh').onclick=refresh;
$('horizon').onchange=render;
$('threshold').onchange=()=>{if($('threshold').checkValidity() && $('threshold').value!=='') render(); else {$('threshold').value='0.5'; render();}};
$('contrast').onclick=()=>{$('contrast').textContent=document.body.classList.toggle('light')?'Fond sombre':'Fond clair';};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{$('notice').textContent='Plein écran indisponible.';}};
$('speak').onclick=()=>{
  if(!('speechSynthesis' in window)){$('notice').textContent='Lecture vocale indisponible.';return;}
  const text=[ $('source-status').textContent, $('notice').textContent, 'Température : '+$('temperature').textContent+' degrés Celsius.', 'Humidité : '+$('humidity').textContent+' pour cent.', 'Pression : '+$('pressure').textContent+' kilopascals.', 'Qualité de l’air : '+$('air-quality').textContent, $('general-summary').textContent, 'Estimations locales expérimentales.', ...Array.from($('daily-forecast').children,a=>a.innerText)].join('. ');
  speechSynthesis.cancel(); const speech=new SpeechSynthesisUtterance(text); speech.lang='fr-CA'; speech.rate=.85;
  speech.onerror=()=>{$('notice').textContent='Lecture vocale indisponible.';}; speechSynthesis.speak(speech);
};
setInterval(refresh,60000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refresh();});
window.addEventListener('online',refresh);
refresh();
