from pathlib import Path
r=Path('source/stroyobem')
d=r/'android_client/lib/main.dart'
s=d.read_text()
s=s.replace('  HttpServer? server;','  HttpServer? server;\n  File? pickedPdf;\n  String pickedToken="";',1)
where="      await controller.addJavaScriptChannel('AndroidExport',onMessageReceived:"
assert where in s
s=s.replace(where,'''      await controller.addJavaScriptChannel('AndroidPDF',onMessageReceived:(m) async {
        if(m.message!='select')return;
        try {
          final result=await FilePicker.platform.pickFiles(type:FileType.custom,allowedExtensions:['pdf'],withData:false);
          if(result==null||result.files.isEmpty)return;
          final item=result.files.single;
          if(item.path==null)throw Exception('Нет пути к файлу');
          pickedPdf=File(item.path!);
          if(await pickedPdf!.length()>40*1024*1024)throw Exception('PDF больше 40 МБ');
          pickedToken=DateTime.now().microsecondsSinceEpoch.toString();
          await controller.runJavaScript('window.onAndroidPdfSelected('+jsonEncode(item.name)+','+jsonEncode('/local-pdf/'+pickedToken)+')');
        }catch(e){message('Ошибка PDF: $e');}
      });
''' + where,1)
where="      if(path.startsWith('/api/')){"
assert where in s
s=s.replace(where,'''      if(path.startsWith('/local-pdf/')){
        if(pickedPdf==null||path!='/local-pdf/'+pickedToken){request.response.statusCode=404;}
        else{
          request.response.headers.contentType=ContentType('application','pdf');
          request.response.headers.set('Cache-Control','no-store');
          request.response.contentLength=await pickedPdf!.length();
          await request.response.addStream(pickedPdf!.openRead());
        }
      }else if(path.startsWith('/api/')){''',1)
s=s.replace("'/sw.js':'sw.js'}","'/sw.js':'sw.js','/pdf.mjs':'pdf.mjs','/pdf.worker.mjs':'pdf.worker.mjs','/offline.js':'offline.js','/auto_detect.js':'auto_detect.js'}",1)
s=s.replace("file.endsWith('.js')?'application/javascript':","(file.endsWith('.js')||file.endsWith('.mjs'))?'application/javascript':",1)
d.write_text(s)
j=r/'web/app.js';a=j.read_text()
a=a.replace('connection(true)}catch(e){connection(false);','connection(r.ok)}catch(e){connection(false);',1)
a=a.replace("async function persist(){dirty=true;rows=[];await localSave();","async function persist(){if(project?.offline){dirty=false;rows=offlineRows();await localSave();render();return}dirty=true;rows=[];await localSave();",1)
a=a.replace("async function calculate(){rows=await api(path('/calculate'));","async function calculate(){if(project?.offline){rows=offlineRows();await cachePut('rows:'+project.id,rows);return}rows=await api(path('/calculate'));",1)
a=a.replace("if(!image){try{image=(await api(path('/page/'+page.id))).image;","if(!image&&project?.offline){try{image=await offlinePage(page);await cachePut('image:'+page.id,image)}catch(e){notify(e.message)}}if(!image&&!project?.offline){try{image=(await api(path('/page/'+page.id))).image;",1)
a=a.replace("const p=await api('/projects','POST',{name});projects.unshift(p);","let p;try{p=await api('/projects','POST',{name})}catch(e){p=offlineProject(name);notify('Создан локальный проект; сервер недоступен')}projects.unshift(p);await cachePut('project:'+p.id,{project:p,dirty:false});await cachePut('projects',projects);",1)
a=a.replace("$('#confirm').onclick=guard(async()=>{project=await api", "$('#confirm').onclick=guard(async()=>{if(project?.offline){const e=elem(),r=rows.find(x=>x.id===selected);if(!e||!r||r.errors.length)throw Error('Невозможно подтвердить расчёт');e.confirmed=true;await persist();return}project=await api",1)
a=a.replace("$('#upload').onchange=guard(async ev=>{","$('#upload').onchange=guard(async ev=>{",1)
a=a.replace("async function download(final){if(dirty)","async function download(final){if(project?.offline)throw Error('XLSX требует подключения к серверу. Экспортируйте копию данных проекта в JSON.');if(dirty)",1)
j.write_text(a)
h=r/'web/index.html';html=h.read_text();html=html.replace('<script src="/app.js"></script>','<script src="/app.js"></script><script src="/offline.js"></script><script src="/auto_detect.js"></script>');h.write_text(html)
b=r/'scripts/build_android.sh';build=b.read_text();build=build.replace(' assets/ui/\npython3',' assets/ui/\ncp "$ROOT/web/offline.js" "$ROOT/web/auto_detect.js" "$ROOT/web/pdf.mjs" "$ROOT/web/pdf.worker.mjs" assets/ui/\npython3',1);b.write_text(build)
print('Offline PDF integration installed')
