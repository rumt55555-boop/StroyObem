'use strict';
/*
 * Conservative, offline raster recognizer for long orthogonal wall candidates.
 * It does not classify reinforcement, foundations, structural materials,
 * openings, and never turns detections into verified quantities.
 */
(function(global){
function findRuns(mask,width,height,direction,minLength){
  const along=direction==='h'?width:height, across=direction==='h'?height:width;
  const bands=[];let active=[];
  for(let pos=0;pos<across;pos++){
    const runs=[];
    let start=-1;
    for(let i=0;i<=along;i++){
      const ink=i<along&&(direction==='h'?mask[pos*width+i]:mask[i*width+pos]);
      if(ink&&start<0)start=i;
      if(!ink&&start>=0){
        if(i-start>=minLength)runs.push({start,end:i});
        start=-1;
      }
    }
    const next=[];
    for(const run of runs){
      let best=null,bestError=Infinity;
      for(const candidate of active){
        if(candidate.last!==pos-1)continue;
        const overlap=Math.min(candidate.end,run.end)-Math.max(candidate.start,run.start);
        const shortest=Math.min(candidate.end-candidate.start,run.end-run.start);
        if(overlap<shortest*.82)continue;
        const error=Math.abs(candidate.start-run.start)+Math.abs(candidate.end-run.end);
        if(error<bestError&&error<Math.max(18,along*.025)){
          best=candidate;bestError=error;
        }
      }
      if(best&&!next.includes(best)){
        best.last=pos;best.start=Math.max(best.start,run.start);
        best.end=Math.min(best.end,run.end);next.push(best);
      }else{
        const item={first:pos,last:pos,start:run.start,end:run.end};
        bands.push(item);next.push(item);
      }
    }
    active=next;
  }
  return bands;
}
function recognizeWallBands(imageData,width,height){
  if(!imageData||width<=0||height<=0||imageData.length<width*height*4)return [];
  const mask=new Uint8Array(width*height);
  for(let i=0;i<mask.length;i++){
    const j=i*4,r=imageData[j],g=imageData[j+1],b=imageData[j+2];
    mask[i]=(imageData[j+3]>200&&Math.max(r,g,b)<155&&((r+g+b)/3)<110)?1:0;
  }
  const minLength=Math.max(32,Math.round(Math.min(width,height)*.065));
  const minThickness=Math.max(4,Math.round(Math.min(width,height)*.004));
  const maxThickness=Math.min(64,Math.round(Math.min(width,height)*.06));
  const results=[];
  for(const direction of ['h','v']){
    const bands=findRuns(mask,width,height,direction,minLength);
    for(const b of bands){
      const thickness=b.last-b.first+1,length=b.end-b.start;
      if(thickness<minThickness||thickness>maxThickness||length<minLength)continue;
      const rect=direction==='h'
        ?{x1:b.start,x2:b.end,y1:b.first,y2:b.last+1}
        :{x1:b.first,x2:b.last+1,y1:b.start,y2:b.end};
      if(rect.x1<width*.025||rect.x2>width*.975||rect.y1<height*.025||rect.y2>height*.975)continue;
      results.push({
        direction,rect,length,
        thickness,
        confidence:Math.min(.83,.49+thickness/95),
        source:'raster-line-band'
      });
    }
  }
  results.sort((a,b)=>b.length-a.length);
  const final=[];
  for(const item of results){
    const a=item.rect;
    const duplicate=final.some(other=>{
      if(other.direction!==item.direction)return false;
      const b=other.rect;
      const ix=Math.max(0,Math.min(a.x2,b.x2)-Math.max(a.x1,b.x1));
      const iy=Math.max(0,Math.min(a.y2,b.y2)-Math.max(a.y1,b.y1));
      return ix*iy/Math.max(1,Math.min((a.x2-a.x1)*(a.y2-a.y1),(b.x2-b.x1)*(b.y2-b.y1)))>.7;
    });
    if(!duplicate)final.push(item);
    if(final.length>=80)break;
  }
  return final;
}
async function scanPageAuto(page){
  if(!page||!project||!project.offline)throw Error('Автораспознавание требует локального PDF');
  const dataURL=await cacheGet('image:'+page.id)||await offlinePage(page);
  const img=new Image();img.src=dataURL;
  await img.decode();
  const maxDim=1400,ratio=Math.min(1,maxDim/Math.max(img.naturalWidth,img.naturalHeight));
  const width=Math.max(1,Math.round(img.naturalWidth*ratio));
  const height=Math.max(1,Math.round(img.naturalHeight*ratio));
  const c=document.createElement('canvas');c.width=width;c.height=height;
  const context=c.getContext('2d',{willReadFrequently:true});
  context.drawImage(img,0,0,width,height);
  const bands=recognizeWallBands(context.getImageData(0,0,width,height).data,width,height);
  const xScale=page.width/width,yScale=page.height/height;
  let added=0;
  for(const d of bands){
    const a=d.rect;
    const center=d.direction==='h'
      ?[[(a.x1)*xScale,(a.y1+a.y2)*.5*yScale],[(a.x2)*xScale,(a.y1+a.y2)*.5*yScale]]
      :[[(a.x1+a.x2)*.5*xScale,a.y1*yScale],[(a.x1+a.x2)*.5*xScale,a.y2*yScale]];
    if(project.elements.some(e=>e.page===page.id&&e.kind==='wall'&&
      e.points?.length===2&&Math.hypot(e.points[0][0]-center[0][0],e.points[0][1]-center[0][1])<8&&
      Math.hypot(e.points[1][0]-center[1][0],e.points[1][1]-center[1][1])<8))continue;
    project.elements.push({
      id:freshId(),page:page.id,kind:'wall',points:center,
      height:null,thickness:null,openings:0,floor:'',axes:'',
      notes:'Автоматически найдено по тёмной полосе (предположение). Проверить тип, проёмы, длину и примыкания.',
      section:'КР',confirmed:false,excluded:false,
      autodetected:true,confidence:d.confidence
    });
    added++;
  }
  return added;
}
async function autoAnalyzeCurrent(){
  if(!page)throw Error('Загрузите PDF');
  if(!project?.offline)throw Error('Автораспознавание пока доступно только для локального PDF');
  notify('Анализ линий на листе…');
  const found=await scanPageAuto(page);
  await localSave();
  rows=offlineRows();
  await cachePut('rows:'+project.id,rows);
  render();
  const needed=page.calibration?.verified
    ?'Укажите высоту и толщину найденных стен, затем проверьте результат.'
    :'Проверьте масштаб по двум точкам, укажите высоту и толщину конструкций.';
  notify('Найдено новых предполагаемых стен: '+found+'. '+needed+
    ' Сканированные и контурные планы могут потребовать ручной разметки.');
  return found;
}
async function assignAutoParameters(){
  if(!page||!project?.offline)throw Error('Откройте локальный PDF');
  const candidates=project.elements.filter(e=>e.page===page.id&&e.autodetected&&!e.confirmed&&!e.excluded);
  if(!candidates.length)throw Error('Нет предложенных стен на этом листе');
  const heightText=prompt('Высота стен, м (из разреза или проекта):');
  if(heightText===null)return;
  const thickText=prompt('Толщина стен, м (например, 0,20, только если подтверждена на чертеже):');
  if(thickText===null)return;
  const height=Number(heightText.replace(',','.')),thickness=Number(thickText.replace(',','.'));
  if(!(height>0&&height<100&&thickness>0&&thickness<5))throw Error('Введите положительные значения в метрах');
  for(const e of candidates){e.height=height;e.thickness=thickness;e.confirmed=false}
  await persist();
  notify(page.calibration?.verified
    ?'Предварительные объёмы рассчитаны. Проверьте каждую стену и возможные дубликаты.'
    :'Параметры назначены. Укажите масштаб по двум точкам для расчёта в м³.');
  switchTab('schedule');
}
function installAutoPanel(){
  const host=document.querySelector('#drawing .heading');
  if(!host||document.getElementById('autoAnalyze'))return;
  const box=document.createElement('div');box.style.cssText='display:flex;flex-direction:column;gap:8px';
  const button=document.createElement('button');button.id='autoAnalyze';button.textContent='◈ Найти стены автоматически';
  const params=document.createElement('button');params.id='autoParameters';params.textContent='Задать высоту и толщину';
  box.append(button,params);host.append(box);
  button.onclick=async()=>{button.disabled=true;try{await autoAnalyzeCurrent()}catch(e){notify('Автоанализ: '+e.message)}finally{button.disabled=false}};
  params.onclick=async()=>{try{await assignAutoParameters()}catch(e){notify(e.message)}};
}
if(typeof window!=='undefined'){
  window.recognizeWallBands=recognizeWallBands;
  installAutoPanel();
  const previous=window.onAndroidPdfSelected;
  window.onAndroidPdfSelected=async(name,url)=>{
    const count=project?.pages?.length||0;
    await previous(name,url);
    if(project?.offline&&project.pages.length>count&&page){
      try{await autoAnalyzeCurrent()}catch(e){notify('PDF загружен. Автораспознавание недоступно: '+e.message)}
    }
  };
}
if(typeof module!=='undefined'&&module.exports)module.exports={recognizeWallBands};
})(typeof window!=='undefined'?window:globalThis);
