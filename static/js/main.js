'use strict';
const $=id=>document.getElementById(id);
const M={temperature:['Température','°C',-50,85,1],humidity:['Humidité','%',0,100,0],pressure:['Pression','kPa',300,1100,1],windSpeed:['Vitesse du vent','km/h',0,250,1],windDirection:['Direction du vent','°',0,360,0],rainfall:['Pluie cumulée','mm',0,1000,1],gasResistance:['Résistance du capteur de gaz','kilo-ohms',0,100000,0]};
const initial={temperature:18,humidity:64,pressure:1013.2,windSpeed:8,windDirection:225,rainfall:0,gasResistance:120};
let raw={...initial},shown={...initial},threshold=.5,history=[],now=Date.now(),horizon=12;
let mode='online', onlineData=null, onlineTemp=null, onlineMessage='Connexion en cours…', requestVersion=0;
const REFRESH_MS=10*60*1000, CACHE_KEY='cart484-montreal-weather-v8';
let lastFetchedAt=0, refreshTimer=null, inFlight=false;
const dirs=['Nord','Nord-est','Est','Sud-est','Sud','Sud-ouest','Ouest','Nord-ouest'];
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function seed(){now=Date.now();history=Array.from({length:13},(_,i)=>({time:now-(12-i)*15*60000,temperature:18+(12-i)*.1,pressure:1013.2+(12-i)*.15}));}
// Least-squares slope using elapsed HOURS, not number of samples.
function slope(rows,key){const xs=rows.map(r=>(r.time-rows[0].time)/3600000),xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=rows.reduce((a,r)=>a+r[key],0)/rows.length;let a=0,b=0;rows.forEach((r,i)=>{a+=(xs[i]-xm)*(r[key]-ym);b+=(xs[i]-xm)**2;});return b?a/b:0;}
function estimate(rows,time,hours){
 const recent=rows.filter(r=>r.time>=time-3*3600000&&r.time<=time).sort((a,b)=>a.time-b.time);
 if(recent.length<7||recent.at(-1).time-recent[0].time<2.5*3600000||time-recent.at(-1).time>30*60000||recent.some((r,i)=>i&&r.time-recent[i-1].time>45*60000))return null;
 const t=clamp(slope(recent,'temperature'),-2,2),p=clamp(slope(recent,'pressure'),-3,3),last=recent.at(-1);
 return {temperatureSlope:t,pressureSlope:p,points:Array.from({length:hours},(_,i)=>{const h=i+1,f=3*(1-Math.exp(-h/3));return {hour:h,temperature:clamp(last.temperature+t*f,-50,85),pressure:clamp(last.pressure+p*f,300,1100)};})};
}
function renderSimulation(){
 $('general-summary').textContent='Simulation : aucune prévision météo réelle.';$('daily-forecast').replaceChildren();$('daily-note').textContent='Les prévisions sur trois jours nécessitent le mode en ligne.';
 $('source-status').textContent='Capteurs · simulation';$('rain-title').textContent='Pluie cumulée';$('rain-note').textContent='Depuis le début de la session';$('gas-note').textContent='Non évaluée en simulation';$('air-quality').textContent='Indisponible';$('forecast-label').textContent='Estimation expérimentale';
 for(const [key,m] of Object.entries(M).filter(([key])=>key!=='gasResistance'))$(key).textContent=key==='windDirection'?`${dirs[Math.round(shown[key]/45)%8]} · ${shown[key].toFixed(0)}°`:(key==='pressure'?shown[key]/10:shown[key]).toFixed(m[4]);
 $('decision').textContent=`Capteur : ${raw.temperature.toFixed(1)} °C · affichage : ${shown.temperature.toFixed(1)} °C. Mise à jour si l’écart dépasse ${threshold.toFixed(1)} °C.`;
 $('clock').textContent='Heure de simulation : '+new Date(now).toLocaleString('fr-CA');
 $('outlook-title').textContent=`Tendance sur ${horizon} heures`;
 const result=estimate(history,now,horizon);$('forecast').replaceChildren();
 if(!result){$('trend').textContent='Historique insuffisant : attendre au moins 2,5 heures de mesures régulières.';return;}
 const t=result.temperatureSlope,p=result.pressureSlope;
 $('trend').textContent=`Température ${t<-.15?'en baisse':t>.15?'en hausse':'stable'} · pression ${p<-.2?'en baisse':p>.2?'en hausse':'stable'}${horizon>5?' · au-delà de 5 h : très incertain':''}`;
 for(const point of result.points){const card=document.createElement('article');card.className='hour';const title=document.createElement('h3');title.textContent=`+${point.hour} h`;const value=document.createElement('strong');value.textContent=`${point.temperature.toFixed(1)} °C`;const pressure=document.createElement('p');pressure.textContent=`${(point.pressure/10).toFixed(1)} kPa`;card.append(title,value,pressure);$('forecast').append(card);}
}
// Values: °C, % RH, hPa, km/h, degrees, mm, kilo-ohms. Timestamp: Unix milliseconds.
// Pass full temperature + pressure observations to build forecast history.
function ingest(sample,time=now){
 if(!Number.isFinite(time)||time<now)return false;
 const accepted={};for(const [key,value] of Object.entries(sample)){const m=M[key];if(m&&typeof value==='number'&&Number.isFinite(value)&&value>=m[2]&&value<=m[3])accepted[key]=value;}
 if(!Object.keys(accepted).length)return false;
 now=time;Object.assign(raw,accepted);
 for(const [key,value] of Object.entries(accepted))if(key!=='temperature'||Math.abs(value-shown.temperature)-threshold>1e-9)shown[key]=value;
 if('temperature' in accepted&&'pressure' in accepted){const row={time,temperature:raw.temperature,pressure:raw.pressure};if(history.at(-1)?.time===time)history[history.length-1]=row;else history.push(row);history=history.filter(r=>r.time>=time-3*3600000);}
 render();return true;
}
function input(){const key=$('sensor').value,m=M[key];const scale=key==='pressure'?10:1;$('sample').value=Number((raw[key]/scale).toFixed(key==='pressure'?2:M[key][4]));$('sample').min=m[2]/scale;$('sample').max=m[3]/scale;$('sample').step=m[4]?0.1:1;$('sample-unit').textContent=`(${m[1]})`;}
for(const [key,m] of Object.entries(M)){const o=document.createElement('option');o.value=key;o.textContent=m[0];$('sensor').append(o);}
$('sensor').onchange=input;
$('manual').onsubmit=e=>{e.preventDefault();ingest({[$('sensor').value]:Number($('sample').value)*($('sensor').value==='pressure'?10:1)});$('notice').textContent='Valeur appliquée. Les projections utilisent les échantillons complets de température et de pression.';};
$('threshold').onchange=()=>{if($('threshold').value===''||!$('threshold').checkValidity()){$('threshold').reportValidity();return;}threshold=Number($('threshold').value);ingest({temperature:raw.temperature});};
$('horizon').onchange=()=>{horizon=Number($('horizon').value);render();};
$('advance').onclick=()=>{ingest({temperature:clamp(raw.temperature-.1+(Math.random()-.5)*.2,-50,85),pressure:clamp(raw.pressure-.15+(Math.random()-.5)*.1,300,1100),humidity:clamp(raw.humidity+Math.round(Math.random()*2-1),0,100),windSpeed:clamp(raw.windSpeed+Math.random()*2-1,0,250),windDirection:(raw.windDirection+Math.round(Math.random()*20-10)+360)%360,rainfall:clamp(raw.rainfall+(Math.random()<.2?.2:0),0,1000),gasResistance:clamp(raw.gasResistance+Math.random()*4-2,0,100000)},now+900000);input();$('notice').textContent='Simulation avancée de 15 minutes.';};
$('reset').onclick=()=>{raw={...initial};shown={...initial};seed();render();input();$('notice').textContent='Données et historique fictif réinitialisés.';};
$('contrast').onclick=()=>{$('contrast').textContent=document.body.classList.toggle('light')?'Fond sombre':'Fond clair';};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(document.documentElement.requestFullscreen)await document.documentElement.requestFullscreen();else $('notice').textContent='Plein écran indisponible.';}catch{$('notice').textContent='Plein écran indisponible.';}};
$('speak').onclick=()=>{if(mode==='online'){speakOnline();return;}if(!('speechSynthesis' in window)){$('notice').textContent='Lecture vocale indisponible.';return;}const units={temperature:'degrés Celsius',humidity:'pour cent',pressure:'kilopascals',windSpeed:'kilomètres par heure',rainfall:'millimètres',gasResistance:'kilo ohms'};const parts=Object.entries(M).filter(([key])=>key!=='gasResistance').map(([key,m])=>`${m[0]} : ${key==='windDirection'?dirs[Math.round(shown[key]/45)%8]:(key==='pressure'?shown[key]/10:shown[key]).toFixed(m[4]).replace('.',',')+' '+units[key]}`);const speech=new SpeechSynthesisUtterance(parts.join('. ')+'. Qualité de l’air indisponible. Tendance expérimentale : '+$('trend').textContent);speech.lang='fr-CA';speech.rate=.85;speech.onerror=()=>{$('notice').textContent='La lecture vocale n’a pas pu démarrer.';};window.speechSynthesis.cancel();window.speechSynthesis.speak(speech);};
window.weatherPrototype={ingest,getState:()=>({raw:{...raw},displayed:{...shown},history:history.map(r=>({...r})),threshold}),clearHistory:()=>{history=[];render();},estimate};
seed();input();restoreWeatherCache();render();refreshIfDue();

function render(){
 for(const id of ['sensor','sample','advance','reset'])$(id).disabled=mode==='online';
 $('manual').querySelector('button').disabled=mode==='online';
 $('refresh').disabled=mode!=='online'||inFlight;
 $('refresh').textContent=inFlight?'Actualisation…':'Actualiser';
 if(mode==='simulation'){renderSimulation();return;}
 const refreshed=lastFetchedAt?new Date(lastFetchedAt).toLocaleString('fr-CA',{timeZone:'America/Toronto',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'}):'jamais';
 $('source-status').textContent='Montréal · Open-Meteo · '+onlineMessage+' · Dernière actualisation réussie : '+refreshed;
 $('rain-title').textContent='Précipitations';$('rain-note').textContent=onlineData?`Sur ${Math.round(onlineData.current.interval/60)} minutes`:'Intervalle courant';
 $('gas-note').textContent='Aucune donnée disponible';$('air-quality').textContent='Indisponible';
 $('outlook-title').textContent=`Prévisions sur ${horizon} heures`;$('forecast-label').textContent='Open-Meteo · modèle météo';
 $('forecast').replaceChildren();renderDaily();
 if(!onlineData){for(const key of ['temperature','humidity','pressure','windSpeed','rainfall','windDirection'])$(key).textContent='—';$('trend').textContent=onlineMessage;return;}
 const c=onlineData.current;const pairs={temperature:onlineTemp,humidity:c.relative_humidity_2m,pressure:Number.isFinite(c.surface_pressure)?c.surface_pressure/10:null,windSpeed:c.wind_speed_10m,rainfall:c.precipitation};
 for(const [key,v] of Object.entries(pairs))$(key).textContent=Number.isFinite(v)?v.toFixed(M[key][4]):'—';
 $('windDirection').textContent=Number.isFinite(c.wind_direction_10m)?`${dirs[Math.round(c.wind_direction_10m/45)%8]} · ${c.wind_direction_10m.toFixed(0)}°`:'—';
 $('decision').textContent=`Valeur reçue : ${c.temperature_2m.toFixed(1)} °C · affichage : ${onlineTemp.toFixed(1)} °C. Seuil : ${threshold.toFixed(1)} °C.`;
 $('clock').textContent='Heure des données : '+new Date(c.time*1000).toLocaleString('fr-CA',{timeZone:'America/Toronto'});
 $('trend').textContent='Température et précipitations prévues';
 const h=onlineData.hourly,cutoff=Math.max(Date.now()/1000,c.time);
 const indices=h.time.map((t,i)=>({t,i})).filter(x=>x.t>cutoff).slice(0,horizon);
 if(!indices.length){$('trend').textContent='Prévisions expirées — actualisez les données.';return;}
 for(const {t,i} of indices){const card=document.createElement('article');card.className='hour';const title=document.createElement('h3');title.textContent=new Date(t*1000).toLocaleTimeString('fr-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit'});const value=document.createElement('strong');value.textContent=Number.isFinite(h.temperature_2m[i])?h.temperature_2m[i].toFixed(1)+' °C':'—';const rain=document.createElement('p');rain.textContent=Number.isFinite(h.precipitation[i])?h.precipitation[i].toFixed(1)+' mm / h':'—';card.append(title,value,rain);$('forecast').append(card);}
}
async function loadOnline(){
 if(mode!=='online'||inFlight)return;
 inFlight=true;clearTimeout(refreshTimer);let succeeded=false;
 const token=++requestVersion,controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),12000);
 onlineMessage=onlineData?'Actualisation…':'Connexion en cours…';render();
 try{
 const url=new URL('https://api.open-meteo.com/v1/forecast');url.search=new URLSearchParams({latitude:'45.5019',longitude:'-73.5674',current:'temperature_2m,relative_humidity_2m,surface_pressure,wind_speed_10m,wind_direction_10m,precipitation,weather_code',hourly:'temperature_2m,precipitation',daily:'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',forecast_days:'4',timezone:'America/Toronto',timeformat:'unixtime',wind_speed_unit:'kmh',temperature_unit:'celsius',precipitation_unit:'mm'}).toString();
 const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();
 if(token!==requestVersion||mode!=='online')return;
 const c=data.current,h=data.hourly;if(!validDaily(data.daily)||!c||!Number.isFinite(c.time)||!Number.isFinite(c.interval)||!Number.isFinite(c.temperature_2m)||!h||!Array.isArray(h.time)||!Array.isArray(h.temperature_2m)||!Array.isArray(h.precipitation)||h.time.length!==h.temperature_2m.length||h.time.length!==h.precipitation.length)throw new Error('Invalid response');
 onlineData=data;lastFetchedAt=Date.now();succeeded=true;if(onlineTemp===null||Math.abs(c.temperature_2m-onlineTemp)-threshold>1e-9)onlineTemp=c.temperature_2m;
 const time=new Date(c.time*1000).toLocaleTimeString('fr-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit'});
 onlineMessage=(Date.now()/1000-c.time>7200?'Données anciennes · ':'')+'données à '+time;
 saveWeatherCache();
 }catch(error){if(token!==requestVersion||mode!=='online')return;onlineMessage=onlineData?'Connexion perdue · dernières données conservées':'Connexion impossible · aucune donnée météo';}
 finally{clearTimeout(timeout);inFlight=false;if(token===requestVersion&&mode==='online'){render();scheduleRefresh(succeeded?undefined:60000);}}
}
function speakOnline(){
 if(!('speechSynthesis' in window)){$('notice').textContent='Lecture vocale indisponible.';return;}
 const text=onlineData?`Montréal. ${onlineMessage}. Température ${$('temperature').textContent} degrés Celsius. Humidité ${$('humidity').textContent} pour cent. Pression ${$('pressure').textContent} kilopascals. Vent ${$('windSpeed').textContent} kilomètres par heure, ${$('windDirection').textContent}. Précipitations ${$('rainfall').textContent} millimètres, ${$('rain-note').textContent}. Qualité de l’air indisponible. ${$('general-summary').textContent} ${$('daily-forecast').textContent}`:'Montréal. '+onlineMessage;
 window.speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(text);speech.lang='fr-CA';speech.rate=.85;speech.onerror=()=>{$('notice').textContent='Lecture vocale indisponible.';};window.speechSynthesis.speak(speech);
}
$('data-mode').onchange=()=>{mode=$('data-mode').value;clearTimeout(refreshTimer);$('notice').textContent='';render();if(mode==='online')refreshIfDue();};
$('refresh').onclick=loadOnline;
$('threshold').onchange=()=>{if($('threshold').value===''||!$('threshold').checkValidity()){$('threshold').reportValidity();return;}threshold=Number($('threshold').value);if(mode==='online'){if(onlineData&&Math.abs(onlineData.current.temperature_2m-onlineTemp)-threshold>1e-9)onlineTemp=onlineData.current.temperature_2m;render();}else ingest({temperature:raw.temperature});};
// A deadline based on the last successful fetch survives reloads via localStorage.
function validCachedData(data){
 const c=data?.current,h=data?.hourly;
 return validDaily(data?.daily)&&c&&Number.isFinite(c.time)&&Number.isFinite(c.interval)&&Number.isFinite(c.temperature_2m)&&h&&Array.isArray(h.time)&&Array.isArray(h.temperature_2m)&&Array.isArray(h.precipitation)&&h.time.length===h.temperature_2m.length&&h.time.length===h.precipitation.length;
}
function restoreWeatherCache(){
 try{
  const cache=JSON.parse(localStorage.getItem(CACHE_KEY));
  if(!cache||!Number.isFinite(cache.fetchedAt)||cache.fetchedAt<=0||cache.fetchedAt>Date.now()||!validCachedData(cache.data))return;
  onlineData=cache.data;lastFetchedAt=cache.fetchedAt;onlineTemp=Number.isFinite(cache.displayedTemperature)?cache.displayedTemperature:onlineData.current.temperature_2m;
  const time=new Date(onlineData.current.time*1000).toLocaleTimeString('fr-CA',{timeZone:'America/Toronto',hour:'2-digit',minute:'2-digit'});
  onlineMessage=(Date.now()/1000-onlineData.current.time>7200?'Données anciennes · ':'')+'données à '+time;
 }catch{ /* Storage unavailable or corrupt: fetch normally. */ }
}
function saveWeatherCache(){
 try{localStorage.setItem(CACHE_KEY,JSON.stringify({fetchedAt:lastFetchedAt,data:onlineData,displayedTemperature:onlineTemp}));}catch{ /* Refresh still works in this open tab. */ }
}
function scheduleRefresh(delay){
 clearTimeout(refreshTimer);
 if(mode!=='online')return;
 const remaining=REFRESH_MS-(Date.now()-lastFetchedAt);
 refreshTimer=setTimeout(refreshIfDue,delay??Math.max(1000,remaining));
}
function refreshIfDue(){
 if(mode!=='online'||inFlight)return;
 const age=Date.now()-lastFetchedAt;
 if(!onlineData||!lastFetchedAt||age>=REFRESH_MS||age<0)loadOnline();
 else {render();scheduleRefresh();}
}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshIfDue();});
window.addEventListener('pageshow',refreshIfDue);
window.addEventListener('focus',refreshIfDue);
window.addEventListener('online',refreshIfDue);

// Daily timestamps are interpreted in Montréal, including daylight-saving changes.
function localDay(seconds){return new Date(seconds*1000).toLocaleDateString('en-CA',{timeZone:'America/Toronto'});}
function validDaily(d){return d&&Array.isArray(d.time)&&d.time.length>=4&&['weather_code','temperature_2m_max','temperature_2m_min','precipitation_probability_max'].every(k=>Array.isArray(d[k])&&d[k].length===d.time.length);}
function weatherDescription(code){
 const descriptions={0:'ciel dégagé',1:'généralement dégagé',2:'partiellement nuageux',3:'ciel couvert',45:'brouillard',48:'brouillard givrant',51:'bruine légère',53:'bruine modérée',55:'bruine dense',56:'bruine verglaçante légère',57:'bruine verglaçante dense',61:'pluie légère',63:'pluie modérée',65:'forte pluie',66:'pluie verglaçante légère',67:'forte pluie verglaçante',71:'neige légère',73:'neige modérée',75:'forte neige',77:'grains de neige',80:'averses légères',81:'averses modérées',82:'fortes averses',85:'averses de neige légères',86:'fortes averses de neige',95:'orages',96:'orages avec grêle',99:'orages avec forte grêle'};
 return descriptions[code]||'conditions indisponibles';
}
function renderDaily(){
 $('daily-forecast').replaceChildren();
 $('daily-note').textContent='';
 if(!onlineData){$('general-summary').textContent=onlineMessage;$('daily-note').textContent='Prévisions indisponibles pour le moment.';return;}
 const today=localDay(Date.now()/1000),d=onlineData.daily;
 const days=validDaily(d)?d.time.map((t,i)=>({t,i,date:localDay(t)})).filter(x=>x.date>today).slice(0,3):[];
 const tomorrowDate=new Date(today+'T12:00:00Z');tomorrowDate.setUTCDate(tomorrowDate.getUTCDate()+1);
 const tomorrow=days.find(x=>x.date===tomorrowDate.toISOString().slice(0,10));
 const currentFresh=Date.now()/1000-onlineData.current.time<7200;
 $('general-summary').textContent=(currentFresh?'En ce moment : '+weatherDescription(onlineData.current.weather_code)+'. ':'')+(tomorrow?'Demain : '+weatherDescription(d.weather_code[tomorrow.i])+'. ':'Prévision de demain indisponible. ');
 if(days.length<3)$('daily-note').textContent='Prévisions incomplètes ou expirées : actualisez les données.';
 for(const {t,i,date} of days){
  const card=document.createElement('article');card.className='day';
  const heading=document.createElement('h3');heading.textContent=(date===tomorrowDate.toISOString().slice(0,10)?'Demain · ':'')+new Date(t*1000).toLocaleDateString('fr-CA',{timeZone:'America/Toronto',weekday:'long',day:'numeric',month:'long'});
  const description=document.createElement('p');description.className='day-condition';description.textContent=weatherDescription(d.weather_code[i])+'. ';
  const temperatures=document.createElement('p');temperatures.textContent='Minimum : '+(Number.isFinite(d.temperature_2m_min[i])?Math.round(d.temperature_2m_min[i])+' degrés Celsius':'indisponible')+'. Maximum : '+(Number.isFinite(d.temperature_2m_max[i])?Math.round(d.temperature_2m_max[i])+' degrés Celsius':'indisponible')+'. ';
  const rain=document.createElement('p');rain.textContent='Risque de précipitations : '+(Number.isFinite(d.precipitation_probability_max[i])?Math.round(d.precipitation_probability_max[i])+' pour cent':'indisponible')+'. ';
  heading.append('. ');card.append(heading,description,temperatures,rain);$('daily-forecast').append(card);
 }
}
