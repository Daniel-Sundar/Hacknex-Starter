// Privacy policy and terms of use (#/privacy, #/terms). Drafts written from what the code actually does.
// Text in [square brackets] is a placeholder the team must fill in; both pages need review by a lawyer
// before ClearScript is offered to the public.
export default {
  "legal.updated": "Last updated: {date}",
  "legal.draft": "Draft for review. ClearScript is a hackathon prototype. Items in [square brackets] still have to be filled in, and these terms have not yet been reviewed by a lawyer.",
  "legal.back": "Back to ClearScript",
  "legal.print": "Print",
  "legal.nav": "Legal",
  "legal.footer.privacy": "Privacy policy",
  "legal.footer.terms": "Terms of use",
  "legal.contact": "[Contact email to be added by the ClearScript team]",

  "legal.privacy.title": "Privacy policy",
  "legal.privacy.intro": "This policy explains what ClearScript does with the pages, words and account details you give it. It describes the app as it is built today.",
  "legal.privacy.short.title": "In short",

  "legal.privacy.s1.title": "Who runs ClearScript",
  "legal.privacy.s1.p1": "ClearScript was built by Daniel S, Ajay, Aaron and Gladys at HackNEX 2026. Operator and legal entity: [to be confirmed]. Contact: {contact}.",

  "legal.privacy.s2.title": "What we collect",
  "legal.privacy.s2.p1": "Pages you digitize: the photo, scan or PDF you upload. The server reads it in memory and does not save the image.",
  "legal.privacy.s2.p2": "Readings: the text each AI model read from a page is cached on the server and, if configured, in our Supabase database. The cache is keyed by a fingerprint of the image, not by who uploaded it, and holds no image.",
  "legal.privacy.s2.p3": "Writer profiles: when you confirm a flagged word with a writer profile set, the word you typed, the word the models read and the profile name are saved on the server and in Supabase. Profiles are tied to your account, or to this browser when you are signed out.",
  "legal.privacy.s2.p4": "History: signed out, your results and a small thumbnail stay in this browser only. Signed in, they are saved to your account in Supabase.",
  "legal.privacy.s2.p5": "Account: if you sign in, Supabase stores your email address and, with Google sign-in, the name and profile photo Google shares. We never see your Google password. Email passwords are stored by Supabase Auth as one-way hashes.",
  "legal.privacy.s2.p6": "Docs Q&A: documents you upload there are kept in server memory, visible only to you, until you remove them or the server restarts.",
  "legal.privacy.s2.p7": "Server logs: our host records technical request logs (IP address, time, page requested, errors). Security events such as rate limiting are logged with a scrambled user tag, never with your email or the text of your pages.",

  "legal.privacy.s3.title": "Why we use it",
  "legal.privacy.s3.p1": "Only to provide the service you asked for: reading your pages, remembering a writer's words, keeping your history, answering questions about your documents, and keeping the service secure and within its free-tier limits. We do not sell your data, show ads or build marketing profiles.",

  "legal.privacy.s4.title": "Who else processes it",
  "legal.privacy.s4.p1": "AI model providers read your pages and documents: Google (Gemini), Groq and OpenRouter (which passes requests to the model provider it routes to). Their own terms and data policies apply to what they receive.",
  "legal.privacy.s4.p2": "Supabase hosts sign-in, history, the reading cache and writer profiles. Render hosts the website and server. The app uses your device's own fonts; only if you pick an Indian-language interface does Google Fonts serve a matching typeface, so your browser then contacts Google. If you use Google sign-in, Google handles that step.",

  "legal.privacy.s5.title": "Cookies and browser storage",
  "legal.privacy.s5.p1": "ClearScript sets no tracking or advertising cookies and uses no analytics. It keeps a few things in your browser's local storage: your theme, language and reading mode, your signed-out history, your sign-in session, and a random browser id that keeps your Docs Q&A documents and writer profiles separate from other people's. Clearing your browser data removes them.",

  "legal.privacy.s6.title": "How long we keep it",
  "legal.privacy.s6.p1": "History: until you delete it. Writer profiles and the reading cache: until the team clears them; no automatic expiry is set yet [retention period to be decided]. Docs Q&A: until you remove the document or the server restarts. Server logs: as long as our host keeps them.",

  "legal.privacy.s7.title": "Security",
  "legal.privacy.s7.p1": "Connections use HTTPS. Your saved history is protected by database row-level security, so each account can read only its own rows. AI provider keys and the database's secret key stay on the server and never reach the browser. No system is perfectly secure, so please do not upload anything you are not allowed to share.",

  "legal.privacy.s8.title": "Health information",
  "legal.privacy.s8.p1": "Prescriptions can contain health information about other people. Upload them only with the patient's consent or another lawful basis. ClearScript has not yet been assessed for compliance with health-data laws [to be reviewed].",

  "legal.privacy.s9.title": "Your choices and rights",
  "legal.privacy.s9.p1": "You can use ClearScript without an account. You can delete history items and Docs Q&A documents yourself in the app. To delete your account, writer profiles or anything else we hold, or to ask what we hold about you, write to {contact}. Depending on where you live (for example under India's Digital Personal Data Protection Act, 2023), you may have further rights.",

  "legal.privacy.s10.title": "Children",
  "legal.privacy.s10.p1": "ClearScript is not meant for children. Do not create an account if you are under 18 [age to be confirmed].",

  "legal.privacy.s11.title": "Changes",
  "legal.privacy.s11.p1": "We will update this page when the app changes what it does with data, and change the date at the top.",

  "legal.terms.title": "Terms of use",
  "legal.terms.intro": "These terms apply when you use ClearScript, its website and its API. By using it, you agree to them.",

  "legal.terms.s1.title": "What ClearScript is",
  "legal.terms.s1.p1": "ClearScript is a free, experimental tool that reads handwriting with several AI models and flags words they disagree on. It is a reading aid, not a medical device, and it does not give medical, legal or professional advice.",

  "legal.terms.s2.title": "Check every result",
  "legal.terms.s2.p1": "AI readings can be wrong even when nothing is flagged. Always check drug names, doses, numbers and anything important against the original page before you act on it. You are responsible for decisions you make using ClearScript's output.",

  "legal.terms.s3.title": "Accounts",
  "legal.terms.s3.p1": "Keep your sign-in details to yourself and tell us if you think someone else has used your account. You are responsible for what happens under your account.",

  "legal.terms.s4.title": "Acceptable use",
  "legal.terms.s4.p1": "Do not upload content you have no right to share, including other people's health records without consent. Do not try to break, overload or get around the service's limits or security, access other people's data, scrape it automatically, or use it for anything unlawful.",

  "legal.terms.s5.title": "Your content",
  "legal.terms.s5.p1": "You keep all rights to the pages and documents you upload. You let us process them, and send them to the AI providers named in the privacy policy, only to provide the service to you.",

  "legal.terms.s6.title": "Our work",
  "legal.terms.s6.p1": "The ClearScript software, name and design belong to its authors [licence to be confirmed]. The AI models belong to their providers.",

  "legal.terms.s7.title": "Availability",
  "legal.terms.s7.p1": "ClearScript runs on free hosting and free AI quotas. It may be slow, sleep when idle, hit limits, change or stop at any time, and data may be lost. There is no fee and no service-level promise.",

  "legal.terms.s8.title": "Suspension",
  "legal.terms.s8.p1": "We may limit or block access that breaks these terms or puts the service or other users at risk.",

  "legal.terms.s9.title": "No warranty and limits of liability",
  "legal.terms.s9.p1": "ClearScript is provided as is, without warranties of any kind. To the extent the law allows, its authors are not liable for losses caused by using it or relying on its output. Nothing here limits rights that the law does not allow us to limit. [To be reviewed by a lawyer.]",

  "legal.terms.s10.title": "Changes and governing law",
  "legal.terms.s10.p1": "We may update these terms and will change the date at the top when we do. Governing law and jurisdiction: [to be confirmed]. Questions: {contact}.",
} as const;
