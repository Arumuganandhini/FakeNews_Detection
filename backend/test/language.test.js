const test = require('node:test');
const assert = require('node:assert');
const { detectLanguage, languageDirective, isSearchable } = require('../utils/language');

const cases = [
  ['ta', 'சென்னை மாநகராட்சி இன்று நடைபெற்ற கூட்டத்தில் புதிய சாலை திட்டத்திற்கு ஒப்புதல் அளித்தது. மேயர் கூறுகையில், பணிகள் ஜனவரி மாதம் தொடங்கும் என்றார்.'],
  ['hi', 'दिल्ली सरकार ने आज एक नई योजना की घोषणा की है और कहा कि काम अगले महीने से शुरू किया जाएगा। मंत्री ने कहा कि यह फैसला जनता के हित में लिया गया है।'],
  ['te', 'హైదరాబాద్ నగరంలో కొత్త మెట్రో మార్గానికి ప్రభుత్వం ఆమోదం తెలిపింది. పనులు వచ్చే నెలలో ప్రారంభమవుతాయని అధికారులు తెలిపారు.'],
  ['ml', 'കൊച്ചിയിൽ പുതിയ പാലത്തിന്റെ നിർമ്മാണം അടുത്ത മാസം ആരംഭിക്കുമെന്ന് മന്ത്രി അറിയിച്ചു.'],
  ['bn', 'কলকাতা পৌরসভা আজ একটি নতুন প্রকল্প অনুমোদন করেছে এবং কাজ আগামী মাসে শুরু হবে বলে জানিয়েছে।'],
  ['kn', 'ಬೆಂಗಳೂರಿನಲ್ಲಿ ಹೊಸ ರಸ್ತೆ ಯೋಜನೆಗೆ ಸರ್ಕಾರ ಅನುಮೋದನೆ ನೀಡಿದೆ ಎಂದು ಅಧಿಕಾರಿಗಳು ತಿಳಿಸಿದ್ದಾರೆ.'],
  ['ru', 'Правительство сообщило, что новая программа начнётся в следующем месяце и будет действовать для всех регионов страны.'],
  ['ja', '東京都は新しい交通計画を発表しました。工事は来月から始まる予定です。'],
  ['zh', '北京市政府今天宣布了新的交通计划，工程将于下个月开始建设。'],
  ['ko', '서울시는 오늘 새로운 교통 계획을 발표했으며 공사는 다음 달에 시작될 예정입니다.'],
  ['ar', 'أعلنت الحكومة اليوم عن خطة جديدة من أجل تحسين الطرق في المدينة على أن تبدأ الأعمال الشهر المقبل.'],
  ['en', 'The city council said on Tuesday that the new road scheme had been approved and that work would begin in January.'],
  ['es', 'El gobierno anunció que el nuevo plan de carreteras fue aprobado y que las obras comenzarán en enero para toda la región.'],
  ['fr', 'Le conseil municipal a annoncé que le nouveau plan routier est approuvé et que les travaux commenceront dans les prochains mois.'],
  ['de', 'Die Stadtverwaltung teilte mit, dass der neue Straßenplan genehmigt ist und die Arbeiten nicht vor Januar beginnen werden.']
];

for (const [expected, text] of cases) {
  test(`detects ${expected}`, () => {
    const result = detectLanguage(text);
    assert.strictEqual(result.code, expected, `got ${result.code} (${result.method}, confidence ${result.confidence})`);
    assert.ok(result.reliable, 'a full sentence should be a reliable detection');
  });
}

test('Hindi and Marathi share a script and are still told apart', () => {
  const marathi = detectLanguage('मुंबई महापालिकेने आज नवीन प्रकल्पाला मान्यता दिली आहे आणि काम पुढील महिन्यात सुरू होणार आहे.');
  assert.strictEqual(marathi.code, 'mr');
  assert.strictEqual(marathi.method, 'script+markers');
});

test('Urdu is distinguished from Arabic', () => {
  const urdu = detectLanguage('حکومت نے کہا ہے کہ نیا منصوبہ اگلے مہینے سے شروع کیا جائے گا اور اس کی منظوری دے دی گئی ہے۔');
  assert.strictEqual(urdu.code, 'ur');
});

test('too little text is reported as unreliable rather than guessed', () => {
  const result = detectLanguage('OK');
  assert.strictEqual(result.reliable, false);
  assert.strictEqual(result.confidence, 0);
});

test('English prompts are left completely unchanged', () => {
  assert.strictEqual(languageDirective({ code: 'en', name: 'English' }), '');
  assert.strictEqual(languageDirective(null), '');
});

test('a non-English directive forbids translating quoted spans', () => {
  const directive = languageDirective({ code: 'ta', name: 'Tamil' });
  assert.match(directive, /Tamil/);
  assert.match(directive, /NOT be translated/);
});

test('languages the news API cannot search are identified', () => {
  assert.strictEqual(isSearchable('en'), true);
  assert.strictEqual(isSearchable('de'), true);
  assert.strictEqual(isSearchable('ta'), false, 'Tamil must fall back to a translated search');
  assert.strictEqual(isSearchable('hi'), false);
});
