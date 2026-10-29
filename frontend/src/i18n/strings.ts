export type Locale = "en" | "hi";
export const LOCALES: { code: Locale; label: string }[] = [{ code: "en", label: "English" }, { code: "hi", label: "हिन्दी" }];

const en = {
  "nav.dashboard": "Dashboard", "nav.data": "My data", "nav.risk": "Risk details", "nav.simulator": "Simulator", "nav.trends": "Trends",
  "nav.reliability": "Model reliability", "nav.report": "Report", "nav.privacy": "Privacy", "nav.signout": "Sign out", "nav.main": "Main",
  "step.1": "My Health Data", "step.2": "AI Analysis", "step.3": "Explain Why", "step.4": "Simulate Changes", "step.5": "Track Over Time",
  "journey": "Your journey", "skip": "Skip to content", "hello": "Hello,",
  "sum.age": "Age", "sum.weight": "Weight", "sum.bmi": "BMI", "sum.glucose": "Glucose",
  "note.experimental": "Experimental model estimate, not a diagnosis.",
  "footer.edu": "HealthTwin is an educational project. Estimates come from models trained on small public research datasets and are not medical advice or a diagnosis.",
  "footer.urgent": "If you have chest pain, trouble breathing, fainting or other urgent symptoms, contact emergency services now.",
  "auth.tagline": "Explore how your numbers may relate to health risk.", "auth.signin": "Sign in", "auth.create": "Create account", "auth.account": "Account",
  "auth.name": "Name (optional)", "auth.email": "Email", "auth.password": "Password", "auth.pwhint": "At least 12 characters, with letters and numbers.",
  "auth.wait": "Please wait…", "auth.consent": "I agree that HealthTwin stores and processes the health data I enter in order to produce estimates. I can export or delete it at any time. (required)",
  "auth.consent_ai": "Allow the optional AI explainer to use my results to write explanations.", "auth.need_consent": "Please agree to the data processing terms to create an account.",
  "auth.footer": "Experimental model estimates, not a diagnosis. Not a medical device.",
  "set.title": "Privacy and data", "set.appearance": "Appearance and language", "set.theme": "Theme", "set.theme.system": "Match my device", "set.theme.light": "Light",
  "set.theme.dark": "Dark", "set.language": "Language", "set.motion": "Reduce motion and animation",
  "set.partial": "Translation covers navigation, sign-in, safety notices and settings. Other screens are still in English.",
  "cmd.title": "Command palette", "cmd.placeholder": "Type a command or page name", "cmd.none": "No matches", "cmd.hint": "Search", "cmd.theme": "Switch theme",
  "cmd.language": "Switch language", "cmd.print": "Print report", "cmd.close": "Close",
} as const;

export type Key = keyof typeof en;

const hi: Record<Key, string> = {
  "nav.dashboard": "डैशबोर्ड", "nav.data": "मेरा डेटा", "nav.risk": "जोखिम विवरण", "nav.simulator": "सिम्युलेटर", "nav.trends": "रुझान",
  "nav.reliability": "मॉडल की विश्वसनीयता", "nav.report": "रिपोर्ट", "nav.privacy": "गोपनीयता", "nav.signout": "साइन आउट", "nav.main": "मुख्य",
  "step.1": "मेरा स्वास्थ्य डेटा", "step.2": "AI विश्लेषण", "step.3": "कारण समझें", "step.4": "बदलाव आज़माएँ", "step.5": "समय के साथ देखें",
  "journey": "आपकी यात्रा", "skip": "सामग्री पर जाएँ", "hello": "नमस्ते,",
  "sum.age": "आयु", "sum.weight": "वज़न", "sum.bmi": "BMI", "sum.glucose": "ग्लूकोज़",
  "note.experimental": "प्रायोगिक मॉडल अनुमान, निदान नहीं।",
  "footer.edu": "HealthTwin एक शैक्षिक परियोजना है। अनुमान छोटे सार्वजनिक शोध डेटासेट पर प्रशिक्षित मॉडलों से आते हैं; ये चिकित्सा सलाह या निदान नहीं हैं।",
  "footer.urgent": "यदि आपको सीने में दर्द, साँस लेने में तकलीफ़, बेहोशी या कोई अन्य आपातकालीन लक्षण है, तो तुरंत आपातकालीन सेवाओं से संपर्क करें (भारत में 112)।",
  "auth.tagline": "जानिए कि आपके आँकड़े स्वास्थ्य जोखिम से कैसे जुड़ सकते हैं।", "auth.signin": "साइन इन", "auth.create": "खाता बनाएँ", "auth.account": "खाता",
  "auth.name": "नाम (वैकल्पिक)", "auth.email": "ईमेल", "auth.password": "पासवर्ड", "auth.pwhint": "कम से कम 12 अक्षर, जिनमें अक्षर और अंक हों।",
  "auth.wait": "कृपया प्रतीक्षा करें…", "auth.consent": "मैं सहमत हूँ कि अनुमान बनाने के लिए HealthTwin मेरे द्वारा दर्ज किया गया स्वास्थ्य डेटा सहेजे और संसाधित करे। मैं इसे कभी भी निर्यात या हटा सकता/सकती हूँ। (आवश्यक)",
  "auth.consent_ai": "वैकल्पिक AI व्याख्याकार को मेरे परिणामों से स्पष्टीकरण लिखने की अनुमति दें।", "auth.need_consent": "खाता बनाने के लिए कृपया डेटा प्रसंस्करण की शर्तों से सहमत हों।",
  "auth.footer": "प्रायोगिक मॉडल अनुमान, निदान नहीं। यह चिकित्सा उपकरण नहीं है।",
  "set.title": "गोपनीयता और डेटा", "set.appearance": "रूप और भाषा", "set.theme": "थीम", "set.theme.system": "मेरे डिवाइस के अनुसार", "set.theme.light": "हल्की",
  "set.theme.dark": "गहरी", "set.language": "भाषा", "set.motion": "गति और एनीमेशन कम करें",
  "set.partial": "अनुवाद में नेविगेशन, साइन-इन, सुरक्षा सूचनाएँ और सेटिंग्स शामिल हैं। अन्य स्क्रीन अभी अंग्रेज़ी में हैं।",
  "cmd.title": "कमांड पैलेट", "cmd.placeholder": "कमांड या पृष्ठ का नाम लिखें", "cmd.none": "कोई परिणाम नहीं", "cmd.hint": "खोजें", "cmd.theme": "थीम बदलें",
  "cmd.language": "भाषा बदलें", "cmd.print": "रिपोर्ट प्रिंट करें", "cmd.close": "बंद करें",
};

export const STRINGS: Record<Locale, Record<Key, string>> = { en, hi };
