let pdfLibrary=null;
function freshId(){return Array.from(crypto.getRandomValues(new Uint8Array(16)),x=>x.toString(16).padStart(2,'0')).join('')}
function offlineProject(name){return {id:freshId(),name,revision:0,pages:[],elements:[],offline:true}}
async function pdfLib(){
 if(!pdfLibrary)pdfLibrary=import('/pdf.mjs').then(m=>{m.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';return m});
 return pdfLibrary;
}
async function offlinePage(pg){
 const blob=await cacheGet('pdf:'+pg.document);
 if(!blob)throw new Error('Исходный PDF не сохранён на устройстве');
 const lib=await pdfLib(),doc=await lib.getDocument({data:new Uint8Array(await blob.arrayBuffer())}).promise;
 try {
  const p=await doc.getPage(pg.number);
  const viewport=p.getViewport({scale:Math.min(2,1600/Math.max(pg.width,pg.height))});
  const c=document.createElement('canvas');c.width=Math.ceil(viewport.width);c.height=Math.ceil(viewport.height);
  await p.render({canvasContext:c.getContext('2d',{alpha:false}),viewport}).promise;
  return c.toDataURL('image/png');
 } finally {await doc.destroy()}
}
async function importLocalPdf(name,url){
 try {
  notify('Обработка PDF на телефоне…');
  const response=await fetch(url);
  if(!response.ok)throw new Error('Android не предоставил доступ к выбранному PDF');
  const bytes=await response.arrayBuffer();
  if(bytes.byteLength>40*1024*1024)throw new Error('PDF больше 40 МБ');
  const lib=await pdfLib();
  const doc=await lib.getDocument({data:new Uint8Array(bytes.slice(0))}).promise;
  let pages=[],id=freshId();
  try{
   if(doc.numPages>150)throw new Error('Максимум 150 страниц');
   for(let i=1;i<=doc.numPages;i++){
    const p=await doc.getPage(i),v=p.view,w=v[2]-v[0],h=v[3]-v[1];
    if(!(w>0&&h>0&&Math.max(w,h)<=5000))throw new Error('Недопустимые размеры страницы '+i);
    pages.push({id:freshId(),document:id,name,number:i,width:w,height:h,calibration:null});
   }
  }finally{await doc.destroy()}
  // An existing server project cannot accept local pages through PUT.
  if(!project||!project.offline){
   project=offlineProject(project?project.name+' (локальная копия)':name.replace(/\.pdf$/i,''));
   projects.unshift(project);
   options($('#projects'),projects.map(p=>[p.id,p.name]),project.id);
  }
  await cachePut('pdf:'+id,new Blob([bytes],{type:'application/pdf'}));
  project.pages.push(...pages);
  page=pages[0];selected=null;dirty=false;
  await localSave();rows=offlineRows();await loadPage();render();
  notify('PDF добавлен локально: '+pages.length+' стр. Для расчёта проверьте масштаб.');
 }catch(e){notify('PDF не загружен: '+e.message)}
}
window.onAndroidPdfSelected=importLocalPdf;
function offlineRows(){
 if(!project)return [];
 const pages=new Map(project.pages.map(p=>[p.id,p]));
 return project.elements.filter(e=>!e.excluded).map(e=>{
  const row={id:e.id,errors:[],confirmed:false};
  try{
   const p=pages.get(e.page),c=p?.calibration;
   if(!c?.verified||!Array.isArray(c.points)||c.points.length!==2)throw Error('Проверьте масштаб');
   const d=Math.hypot(c.points[0][0]-c.points[1][0],c.points[0][1]-c.points[1][1]);
   if(!(d>0&&c.meters>0))throw Error('Некорректная калибровка');
   const s=c.meters/d,h=Number(e.height),o=Number(e.openings||0),pts=e.points;
   if(!(h>0&&o>=0)||!pts.every(p=>p[0]>=0&&p[1]>=0&&p[0]<=pages.get(e.page).width&&p[1]<=pages.get(e.page).height))throw Error('Неверные параметры');
   let v,formula,substitution;
   if(e.kind==='wall'){
    if(pts.length!==2||!(e.thickness>0))throw Error('Стена: нужны две точки и толщина');
    const L=Math.hypot(pts[0][0]-pts[1][0],pts[0][1]-pts[1][1])*s;
    if(!(L>0)||o>=L*h)throw Error('Некорректная длина или проёмы');
    v=(L*h-o)*e.thickness;formula='V = (L × H − Sпр) × t';
    substitution='('+L.toFixed(3)+' × '+h+' − '+o+') × '+e.thickness;
   }else{
    if(pts.length<3)throw Error('Для площади нужны три вершины');
    const A=Math.abs(pts.reduce((v,p,i)=>v+p[0]*pts[(i+1)%pts.length][1]-pts[(i+1)%pts.length][0]*p[1],0))*s*s/2;
    if(!(A>0)||o>=A||e.kind==='pit'&&o)throw Error('Неверная площадь или отверстия');
    v=(A-o)*h;formula='V = (S − Sотв) × h';substitution='('+A.toFixed(3)+' − '+o+') × '+h;
   }
   if(!Number.isFinite(v))throw Error('Неверное числовое значение');
   Object.assign(row,{value:v,formula,substitution,unit:'м³',confirmed:!!e.confirmed});
  }catch(error){row.errors.push(error.message)}
  return row;
 });
}
$('#upload').parentElement.addEventListener('click',e=>{
 if(window.AndroidPDF){e.preventDefault();AndroidPDF.postMessage('select')}
});
