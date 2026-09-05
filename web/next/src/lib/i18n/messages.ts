/**
 * Localisation for the merchant-facing surfaces: onboarding, navigation, and decision screens.
 *
 * Scope is deliberate. These are the strings a merchant reads while deciding whether to trust the
 * product, and while deciding whether someone's money settles. Getting those wrong in someone's own
 * language is worse than not offering the language at all, so the coverage here is clear and
 * complete rather than broad and machine-shaped.
 *
 * Translation notes, since a wrong word here has consequences:
 *   - "Hold" is rendered as "रोका गया / રોકી રાખેલ" (stopped/kept), never as "रद्द / રદ" (cancelled).
 *     The whole product promise is that a hold is not a cancellation, and a mistranslation here
 *     would state the opposite of what the system does.
 *   - "Release" is "जारी करें / રિલીઝ કરો" in the sense of letting money through, not "छोड़ें"
 *     (abandon).
 *   - Money and time are left in digits. Transliterating amounts or deadlines into words is how
 *     someone misreads ₹5,000 as ₹500 under time pressure.
 */

export const LOCALES = ["en", "hi", "mr", "gu"] as const
export type Locale = (typeof LOCALES)[number]

export const LOCALE_LABEL: Record<Locale, string> = {
  en: "English",
  hi: "हिन्दी",
  mr: "मराठी",
  gu: "ગુજરાતી",
}

export type MessageKey =
  | "nav.brand"
  | "nav.evidence"
  | "nav.overview"
  | "nav.queue"
  | "nav.holds"
  | "nav.analysis"
  | "nav.accuracy"
  | "nav.connect"
  | "nav.syntheticData"
  | "hero.badge"
  | "hero.title"
  | "hero.subtitle"
  | "hero.connectCta"
  | "hero.queueCta"
  | "hero.recallLabel"
  | "hero.precisionLabel"
  | "hero.householdsLabel"
  | "hero.trustWarning"
  | "onboard.title"
  | "onboard.subtitle"
  | "onboard.connect"
  | "onboard.demo"
  | "onboard.csv"
  | "onboard.readonly"
  | "onboard.encrypted"
  | "onboard.ownInfra"
  | "hold.title"
  | "hold.subtitle"
  | "hold.none"
  | "hold.heldLabel"
  | "hold.notCancelled"
  | "hold.amount"
  | "hold.reason"
  | "hold.expiresIn"
  | "hold.autoRefund"
  | "hold.release"
  | "hold.reject"
  | "hold.releaseHint"
  | "hold.rejectHint"
  | "hold.decidedBy"
  | "hold.reasonRequired"
  | "hold.agentNeverActs"
  | "metrics.title"
  | "metrics.subtitle"
  | "queue.title"
  | "queue.subtitle"

type Messages = Record<MessageKey, string>

const en: Messages = {
  "nav.evidence": "Evidence",
  "nav.brand": "AI Risk Manager",
  "nav.overview": "Overview",
  "nav.queue": "Ring queue",
  "nav.holds": "Held payments",
  "nav.analysis": "Analysis",
  "nav.accuracy": "Accuracy",
  "nav.connect": "Connect",
  "nav.syntheticData": "Synthetic data",

  "hero.badge": "Abuse-ring sentinel · defence-only",
  "hero.title": "The fraud that costs you most doesn't look like fraud on any single transaction.",
  "hero.subtitle":
    "Promo farming and chargeback rings run through accounts that each look perfectly ordinary. This finds the group, explains exactly why it flagged it, and leaves the family that happens to share an address alone.",
  "hero.connectCta": "Connect your account",
  "hero.queueCta": "See a live ring queue",
  "hero.recallLabel": "of true rings caught on a held-out test split",
  "hero.precisionLabel": "of what it flags is a real ring",
  "hero.householdsLabel": "legitimate households wrongly flagged",
  "hero.trustWarning":
    "Read this before you trust the numbers above. They are measured on synthetic data, on a split the detector never saw. That proves the implementation works.",

  "onboard.title": "Connect Razorpay. The agent does the rest.",
  "onboard.subtitle":
    "Add your API keys once. The agent watches every payment, holds the ones that look like a coordinated ring, and asks you to decide. It never cancels anything by itself.",
  "onboard.connect": "Connect your Razorpay account",
  "onboard.demo": "Try it on sample data first",
  "onboard.csv": "Upload a CSV export instead",
  "onboard.readonly": "Read-only. It cannot move your money.",
  "onboard.encrypted": "Your API secret is encrypted before it is stored.",
  "onboard.ownInfra": "Runs on your own infrastructure.",

  "hold.title": "Held payments",
  "hold.subtitle": "Payments the agent has stopped from settling, waiting for your decision.",
  "hold.none": "Nothing is being held. Every payment has settled normally.",
  "hold.heldLabel": "Held",
  "hold.notCancelled":
    "This payment is not cancelled. The customer's money is reserved but not yet taken. You decide what happens.",
  "hold.amount": "Amount",
  "hold.reason": "Why it was held",
  "hold.expiresIn": "Decide within",
  "hold.autoRefund": "If you do nothing, the customer is automatically refunded.",
  "hold.release": "Release payment",
  "hold.reject": "Refund customer",
  "hold.releaseHint": "The money settles to you as normal.",
  "hold.rejectHint": "The customer gets their money back.",
  "hold.decidedBy": "Your name",
  "hold.reasonRequired": "Please give a reason.",
  "hold.agentNeverActs": "The agent never releases or refunds on its own. Only you can.",

  "metrics.title": "Detector metrics",
  "metrics.subtitle":
    "Measured on a held-out split the detector never saw. Not recomputed on page load.",
  "queue.title": "Ring queue",
  "queue.subtitle":
    "Coordinated fraud rings detected across merchant transactions, ranked by risk score.",
}

const hi: Messages = {
  "nav.evidence": "प्रमाण",
  "nav.brand": "एआई रिस्क मैनेजर",
  "nav.overview": "अवलोकन",
  "nav.queue": "संदिग्ध समूह",
  "nav.holds": "रोके गए भुगतान",
  "nav.analysis": "विश्लेषण",
  "nav.accuracy": "सटीकता",
  "nav.connect": "जोड़ें",
  "nav.syntheticData": "सिंथेटिक डेटा",

  "hero.badge": "धोखाधड़ी रिंग सेंटिनल · केवल सुरक्षा",
  "hero.title": "सबसे अधिक नुकसान पहुँचाने वाली धोखाधड़ी किसी एक लेनदेन में नहीं दिखती।",
  "hero.subtitle":
    "प्रोमो फार्मिंग और सुनियोजित चार्जबैक गिरोह ऐसे खातों से संचालित होते हैं जो व्यक्तिगत रूप से सामान्य दिखते हैं। यह प्रणाली उन समूहों को खोजती है, कारण स्पष्ट करती है, और सामान्य परिवारों को सुरक्षित रखती है।",
  "hero.connectCta": "अपना खाता जोड़ें",
  "hero.queueCta": "लाइव रिंग कतार देखें",
  "hero.recallLabel": "परीक्षण डेटा पर पकड़े गए वास्तविक रिंग",
  "hero.precisionLabel": "चिह्नित किए गए में से वास्तविक रिंग",
  "hero.householdsLabel": "गलत तरीके से चिह्नित किए गए सामान्य परिवार",
  "hero.trustWarning":
    "इन आंकड़ों को देखने से पहले ध्यान दें: ये सिंथेटिक डेटा के परीक्षण विभाजन पर मापे गए हैं जिन्हें डिटेक्टर ने पहले कभी नहीं देखा।",

  "onboard.title": "Razorpay जोड़ें। बाकी काम एजेंट करेगा।",
  "onboard.subtitle":
    "एक बार अपनी API कुंजी जोड़ें। एजेंट हर भुगतान पर नज़र रखता है, जो संगठित गिरोह जैसा लगे उसे रोक देता है, और निर्णय आपसे पूछता है। वह खुद कुछ भी रद्द नहीं करता।",
  "onboard.connect": "अपना Razorpay खाता जोड़ें",
  "onboard.demo": "पहले नमूना डेटा पर आज़माएँ",
  "onboard.csv": "इसके बजाय CSV फ़ाइल अपलोड करें",
  "onboard.readonly": "केवल पढ़ने की अनुमति। यह आपका पैसा नहीं हिला सकता।",
  "onboard.encrypted": "आपकी API गुप्त कुंजी संग्रहित करने से पहले एन्क्रिप्ट की जाती है।",
  "onboard.ownInfra": "आपके अपने सर्वर पर चलता है।",

  "hold.title": "रोके गए भुगतान",
  "hold.subtitle": "वे भुगतान जिन्हें एजेंट ने बसने से रोका है, आपके निर्णय की प्रतीक्षा में।",
  "hold.none": "कोई भुगतान रोका नहीं गया है। सभी भुगतान सामान्य रूप से पूरे हुए।",
  "hold.heldLabel": "रोका गया",
  "hold.notCancelled":
    "यह भुगतान रद्द नहीं हुआ है। ग्राहक का पैसा सुरक्षित रखा गया है, अभी लिया नहीं गया। आगे क्या हो, यह आप तय करेंगे।",
  "hold.amount": "राशि",
  "hold.reason": "क्यों रोका गया",
  "hold.expiresIn": "इतने समय में निर्णय लें",
  "hold.autoRefund": "यदि आप कुछ नहीं करते, तो ग्राहक को पैसा अपने आप वापस मिल जाएगा।",
  "hold.release": "भुगतान जारी करें",
  "hold.reject": "ग्राहक को धनवापसी करें",
  "hold.releaseHint": "पैसा सामान्य रूप से आपके खाते में आ जाएगा।",
  "hold.rejectHint": "ग्राहक को उसका पैसा वापस मिल जाएगा।",
  "hold.decidedBy": "आपका नाम",
  "hold.reasonRequired": "कृपया कारण बताएँ।",
  "hold.agentNeverActs": "एजेंट अपने आप न भुगतान जारी करता है, न धनवापसी। यह केवल आप कर सकते हैं।",

  "metrics.title": "डिटेक्टर मेट्रिक्स",
  "metrics.subtitle": "परीक्षण डेटा पर मापा गया जिसे डिटेक्टर ने कभी नहीं देखा।",
  "queue.title": "संदिग्ध समूह कतार",
  "queue.subtitle": "लेनदेन में पकड़े गए धोखाधड़ी गिरोह, जोखिम स्कोर के अनुसार क्रमबद्ध।",
}

const mr: Messages = {
  "nav.evidence": "पुरावा",
  "nav.brand": "एआय जोखीम व्यवस्थापक",
  "nav.overview": "आढावा",
  "nav.queue": "संशयित गट",
  "nav.holds": "रोखलेली देयके",
  "nav.analysis": "विश्लेषण",
  "nav.accuracy": "अचूकता",
  "nav.connect": "जोडा",
  "nav.syntheticData": "सिंथेटिक डेटा",

  "hero.badge": "फसवणूक रिंग सेंटिनेल · फक्त संरक्षण",
  "hero.title": "सर्वात जास्त नुकसान करणारी फसवणूक कोणत्याही एका व्यवहारात दिसत नाही.",
  "hero.subtitle":
    "प्रोमो फार्मिंग आणि फसवणूक करणाऱ्या टोळ्या सामान्य दिसणाऱ्या खात्यांमधून चालतात. ही प्रणाली ते गट शोधते, स्पष्ट कारण देते आणि सामान्य कुटुंबांना सुरक्षित ठेवते.",
  "hero.connectCta": "तुमचे खाते जोडा",
  "hero.queueCta": "थेट रिंग रांग पाहा",
  "hero.recallLabel": "चाचणी डेटावर पकडलेल्या खऱ्या टोळ्या",
  "hero.precisionLabel": "फ्लॅग केलेल्यांपैकी खरी टोळी",
  "hero.householdsLabel": "चुकीच्या पद्धतीने फ्लॅग केलेले सामान्य कुटुंब",
  "hero.trustWarning":
    "हे आकडे पाहण्यापूर्वी लक्षात घ्या: हे सिंथेटिक डेटाच्या चाचणी विभागावर मोजले गेले आहेत जे डिटेक्टरने आधी पाहिले नव्हते.",

  "onboard.title": "Razorpay जोडा. बाकीचे काम एजंट करेल.",
  "onboard.subtitle":
    "एकदा तुमच्या API किल्ल्या जोडा. एजंट प्रत्येक देयकावर लक्ष ठेवतो, संघटित टोळीसारखे वाटणारे देयक रोखतो, आणि निर्णय तुम्हाला विचारतो. तो स्वतः काहीही रद्द करत नाही.",
  "onboard.connect": "तुमचे Razorpay खाते जोडा",
  "onboard.demo": "आधी नमुना डेटावर पाहा",
  "onboard.csv": "त्याऐवजी CSV फाइल अपलोड करा",
  "onboard.readonly": "फक्त वाचण्याची परवानगी. ते तुमचे पैसे हलवू शकत नाही.",
  "onboard.encrypted": "तुमची API गुप्त किल्ली साठवण्यापूर्वी एन्क्रिप्ट केली जाते.",
  "onboard.ownInfra": "तुमच्याच सर्व्हरवर चालते.",

  "hold.title": "रोखलेली देयके",
  "hold.subtitle": "एजंटने जमा होण्यापासून रोखलेली देयके, तुमच्या निर्णयाच्या प्रतीक्षेत.",
  "hold.none": "कोणतेही देयक रोखलेले नाही. सर्व देयके सामान्यपणे पूर्ण झाली.",
  "hold.heldLabel": "रोखले",
  "hold.notCancelled":
    "हे देयक रद्द झालेले नाही. ग्राहकाचे पैसे राखून ठेवले आहेत, अजून घेतलेले नाहीत. पुढे काय करायचे ते तुम्ही ठरवाल.",
  "hold.amount": "रक्कम",
  "hold.reason": "का रोखले",
  "hold.expiresIn": "इतक्या वेळात निर्णय घ्या",
  "hold.autoRefund": "तुम्ही काहीच केले नाही, तर ग्राहकाला पैसे आपोआप परत मिळतील.",
  "hold.release": "देयक जारी करा",
  "hold.reject": "ग्राहकाला परतावा द्या",
  "hold.releaseHint": "पैसे नेहमीप्रमाणे तुमच्या खात्यात जमा होतील.",
  "hold.rejectHint": "ग्राहकाला त्याचे पैसे परत मिळतील.",
  "hold.decidedBy": "तुमचे नाव",
  "hold.reasonRequired": "कृपया कारण द्या.",
  "hold.agentNeverActs": "एजंट स्वतःहून देयक जारी करत नाही किंवा परतावा देत नाही. ते फक्त तुम्हीच करू शकता.",

  "metrics.title": "डिटेक्टर मेट्रिक्स",
  "metrics.subtitle": "डिटेक्टरने कधीही न पाहिलेल्या चाचणी डेटावर मोजले गेले.",
  "queue.title": "संशयित गट रांग",
  "queue.subtitle": "व्यवहारांमध्ये शोधलेल्या फसवणूक टोळ्या, जोखीम स्कोअरनुसार क्रमवारी.",
}

const gu: Messages = {
  "nav.evidence": "પુરાવો",
  "nav.brand": "AI જોખમ વ્યવસ્થાપક",
  "nav.overview": "ઝાંખી",
  "nav.queue": "શંકાસ્પદ જૂથ",
  "nav.holds": "રોકી રાખેલ ચુકવણી",
  "nav.analysis": "વિશ્લેષણ",
  "nav.accuracy": "ચોકસાઈ",
  "nav.connect": "જોડો",
  "nav.syntheticData": "સિન્થેટિક ડેટા",

  "hero.badge": "છેતરપિંડી રિંગ સેન્ટિનલ · ફક્ત સંરક્ષણ",
  "hero.title": "સૌથી વધુ નુકસાન કરતી છેતરપિંડી કોઈ એક વ્યવહારમાં દેખાતી નથી.",
  "hero.subtitle":
    "પ્રોમો ફાર્મિંગ અને વ્યવસ્થિત ચાર્જબૅક ટોળકીઓ સામાન્ય દેખાતા ખાતાઓ દ્વારા ચાલે છે. આ સિસ્ટમ તે જૂથોને શોધે છે, ચોક્કસ કારણ આપે છે અને સામાન્ય પરિવારોનું રક્ષણ કરે છે.",
  "hero.connectCta": "તમારું ખાતું જોડો",
  "hero.queueCta": "લાઇવ રિંગ કતાર જુઓ",
  "hero.recallLabel": "પરીક્ષણ ડેટા પર પકડાયેલ વાસ્તવિક રિંગ",
  "hero.precisionLabel": "ફ્લેગ કરેલામાંથી વાસ્તવિક રિંગ",
  "hero.householdsLabel": "ખોટી રીતે ફ્લેગ થયેલ સામાન્ય પરિવારો",
  "hero.trustWarning":
    "આ આંકડા જોતાં પહેલાં નોંધ લો: તે સિન્થેટિક ડેટાના પરીક્ષણ વિભાજન પર માપવામાં આવ્યા છે જે ડિટેક્ટરે ક્યારેય જોયા નથી.",

  "onboard.title": "Razorpay જોડો. બાકીનું કામ એજન્ટ કરશે.",
  "onboard.subtitle":
    "એક વાર તમારી API કી ઉમેરો. એજન્ટ દરેક ચુકવણી પર નજર રાખે છે, જે સંગઠિત ટોળકી જેવી લાગે તેને રોકી રાખે છે, અને નિર્ણય તમને પૂછે છે. તે જાતે કશું રદ કરતો નથી.",
  "onboard.connect": "તમારું Razorpay ખાતું જોડો",
  "onboard.demo": "પહેલાં નમૂના ડેટા પર અજમાવો",
  "onboard.csv": "તેના બદલે CSV ફાઇલ અપલોડ કરો",
  "onboard.readonly": "ફક્ત વાંચવાની પરવાનગી. તે તમારા પૈસા ખસેડી શકતું નથી.",
  "onboard.encrypted": "તમારી API ગુપ્ત કી સંગ્રહ પહેલાં એન્ક્રિપ્ટ થાય છે.",
  "onboard.ownInfra": "તમારા પોતાના સર્વર પર ચાલે છે.",

  "hold.title": "રોકી રાખેલ ચુકવણી",
  "hold.subtitle": "એજન્ટે જમા થતાં અટકાવેલી ચુકવણીઓ, તમારા નિર્ણયની રાહમાં.",
  "hold.none": "કોઈ ચુકવણી રોકી નથી. બધી ચુકવણી સામાન્ય રીતે પૂરી થઈ.",
  "hold.heldLabel": "રોકી રાખેલ",
  "hold.notCancelled":
    "આ ચુકવણી રદ થઈ નથી. ગ્રાહકના પૈસા અલગ રાખ્યા છે, હજી લીધા નથી. આગળ શું કરવું તે તમે નક્કી કરશો.",
  "hold.amount": "રકમ",
  "hold.reason": "કેમ રોકી",
  "hold.expiresIn": "આટલા સમયમાં નિર્ણય લો",
  "hold.autoRefund": "તમે કશું નહીં કરો, તો ગ્રાહકને પૈસા આપોઆપ પાછા મળી જશે.",
  "hold.release": "ચુકવણી રિલીઝ કરો",
  "hold.reject": "ગ્રાહકને રિફંડ આપો",
  "hold.releaseHint": "પૈસા સામાન્ય રીતે તમારા ખાતામાં જમા થશે.",
  "hold.rejectHint": "ગ્રાહકને તેના પૈસા પાછા મળશે.",
  "hold.decidedBy": "તમારું નામ",
  "hold.reasonRequired": "કૃપા કરીને કારણ આપો.",
  "hold.agentNeverActs": "એજન્ટ જાતે ચુકવણી રિલીઝ કે રિફંડ કરતો નથી. તે ફક્ત તમે જ કરી શકો.",

  "metrics.title": "ડિટેક્ટર મેટ્રિક્સ",
  "metrics.subtitle": "પરીક્ષણ ડેટા પર માપવામાં આવેલ જેને ડિટેક્ટરે ક્યારેય જોયો નથી.",
  "queue.title": "શંકાસ્પદ જૂથ કતાર",
  "queue.subtitle": "વ્યવહારોમાં પકડાયેલી છેતરપિંડી રિંગ્સ, જોખમ સ્કોર મુજબ ક્રમાંકિત.",
}

export const MESSAGES: Record<Locale, Messages> = { en, hi, mr, gu }

/** Falls back to English for any key a locale is missing, so a gap shows as English rather than a
 *  raw key or an empty button. On a screen where someone is deciding about money, a blank control
 *  is far worse than one in the wrong language. */
export function t(locale: Locale, key: MessageKey): string {
  return MESSAGES[locale]?.[key] ?? MESSAGES.en[key]
}
