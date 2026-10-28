from pathlib import Path
p = Path('source/stroyobem/android_client/lib/main.dart')
s = p.read_text(encoding='utf-8')
s = s.replace("import 'package:cross_file/cross_file.dart';\n", '')
start_marker = "          final field=TextEditingController(text:r.defaultText);"
end_marker = "        });"
assert start_marker in s, 'JS dialog source changed'
a = s.index(start_marker)
b = s.index(end_marker, a)
s = s[:a] + """          final result=await showDialog<String>(
            context:context,
            builder:(_)=>TextEntryDialog(title:r.message, initialValue:r.defaultText),
          );
          return result??'';
""" + s[b:]
start_marker = "    final text=TextEditingController(text:upstream);"
end_marker = "    final uri=Uri.tryParse(value.trim());"
assert start_marker in s, 'Settings source changed'
a = s.index(start_marker)
b = s.index(end_marker, a)
s = s[:a] + """    final value=await showDialog<String>(
      context:context,
      builder:(_)=>TextEntryDialog(
        title:'Адрес вашего сервера',
        initialValue:upstream,
        explanation:'Эмулятор: http://10.0.2.2:8000\\nТелефон: адрес компьютера в доверенной локальной сети. Для удалённого доступа нужен защищённый сервер.',
        acceptText:'Подключить',
      ),
    );
    if(value==null||!mounted)return;
""" + s[b:]
assert 'text.dispose()' not in s and 'field.dispose()' not in s
s += """

// Let the dialog own its controller until the route is completely disposed.
// showDialog's Future resolves before the dialog exit animation completes.
class TextEntryDialog extends StatefulWidget {
  const TextEntryDialog({
    super.key,
    required this.title,
    required this.initialValue,
    this.explanation,
    this.acceptText='Сохранить',
  });
  final String title;
  final String initialValue;
  final String? explanation;
  final String acceptText;
  @override
  State<TextEntryDialog> createState()=>_TextEntryDialogState();
}

class _TextEntryDialogState extends State<TextEntryDialog> {
  late final TextEditingController controller;

  @override
  void initState(){
    super.initState();
    controller=TextEditingController(text:widget.initialValue);
  }

  @override
  void dispose(){
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context)=>AlertDialog(
    title:Text(widget.title),
    content:Column(mainAxisSize:MainAxisSize.min,children:[
      if(widget.explanation!=null)...[
        Text(widget.explanation!),
        const SizedBox(height:12),
      ],
      TextField(controller:controller,autofocus:true,
        onSubmitted:(value)=>Navigator.of(context).pop(value)),
    ]),
    actions:[
      TextButton(onPressed:()=>Navigator.of(context).pop(),child:const Text('Отмена')),
      FilledButton(onPressed:()=>Navigator.of(context).pop(controller.text),child:Text(widget.acceptText)),
    ],
  );
}
"""
p.write_text(s, encoding='utf-8')
test = Path('source/stroyobem/android_client/test/dialog_lifecycle_test.dart')
test.parent.mkdir(parents=True, exist_ok=True)
test.write_text("""import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:stroyobem/main.dart';

void main() {
  testWidgets('text dialog can open and dismiss twice without lifecycle errors', (tester) async {
    await tester.pumpWidget(MaterialApp(home:Builder(builder:(context)=>Scaffold(
      body:TextButton(onPressed:(){
        showDialog<String>(context:context,builder:(_)=>const TextEntryDialog(
          title:'Адрес сервера',initialValue:'http://localhost:8000',acceptText:'Подключить'));
      },child:const Text('Открыть')),
    ))));
    for (var i=0;i<2;i++) {
      await tester.tap(find.text('Открыть'));
      await tester.pumpAndSettle();
      expect(find.byType(TextField),findsOneWidget);
      await tester.tap(find.text('Подключить'));
      await tester.pumpAndSettle();
      expect(find.text('Открыть'),findsOneWidget);
      expect(tester.takeException(),isNull);
    }
  });
}
""", encoding='utf-8')
print('Android runtime source patched; lifecycle test added.')
