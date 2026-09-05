const BASE = [
  ["Work", "blue", ["docs.google.com", "drive.google.com", "calendar.google.com", "notion.so", "notion.site", "slack.com", "office.com", "office365.com", "microsoft365.com", "airtable.com", "trello.com", "asana.com", "linear.app", "clickup.com", "atlassian.net"]],
  ["Developer", "purple", ["github.com", "gitlab.com", "bitbucket.org", "stackoverflow.com", "stackexchange.com", "developer.mozilla.org", "developer.chrome.com", "npmjs.com", "vercel.com", "netlify.com", "cloudflare.com", "workers.dev", "pages.dev", "vercel.app", "netlify.app", "supabase.com", "supabase.co", "firebase.google.com", "console.firebase.google.com", "console.cloud.google.com", "console.aws.amazon.com", "aws.amazon.com", "azure.com", "portal.azure.com", "digitalocean.com", "render.com", "railway.com", "railway.app", "fly.io", "docker.com", "postman.com", "sentry.io", "posthog.com", "launchdarkly.com", "logrocket.com", "replit.com", "codepen.io", "codesandbox.io", "cursor.com", "clerk.com", "resend.com", "neon.tech", "planetscale.com", "clarity.ms", "clarity.microsoft.com", "localhost"]],
  ["AI Apps", "cyan", ["chatgpt.com", "claude.ai", "gemini.google.com", "perplexity.ai", "aistudio.google.com", "openai.com", "anthropic.com", "poe.com", "grok.com", "copilot.microsoft.com", "huggingface.co", "midjourney.com", "leonardo.ai", "ideogram.ai", "runwayml.com", "suno.com", "udio.com", "elevenlabs.io", "gamma.app", "lovable.dev", "bolt.new", "v0.app", "v0.dev", "deepseek.com", "notebooklm.google.com"]],
  ["Shopping", "orange", ["amazon.com", "amazon.ae", "amazon.co.uk", "amazon.de", "amazon.in", "ebay.com", "etsy.com", "aliexpress.com", "noon.com", "walmart.com", "target.com", "ikea.com"]],
  ["Media", "red", ["youtube.com", "youtu.be", "netflix.com", "vimeo.com", "twitch.tv", "spotify.com", "music.apple.com", "disneyplus.com", "primevideo.com", "soundcloud.com", "music.youtube.com", "podcasts.apple.com", "dailymotion.com", "hulu.com", "max.com", "plex.tv", "nebula.tv"]],
  ["Social", "pink", ["reddit.com", "x.com", "twitter.com", "instagram.com", "facebook.com", "linkedin.com", "threads.net", "threads.com", "tiktok.com", "discord.com"]],
  ["News", "yellow", ["bbc.com", "bbc.co.uk", "cnn.com", "reuters.com", "apnews.com", "theguardian.com", "nytimes.com", "bloomberg.com", "ft.com", "wsj.com"]],
  ["Travel", "green", ["booking.com", "airbnb.com", "expedia.com", "tripadvisor.com", "skyscanner.net", "emirates.com", "etihad.com", "maps.google.com"]],
  ["Research & Learning", "yellow", ["google.com", "google.ae", "google.co.uk", "bing.com", "duckduckgo.com", "wikipedia.org", "scholar.google.com", "arxiv.org"]],
  ["Mail", "grey", ["mail.google.com", "outlook.live.com", "outlook.office.com", "mail.yahoo.com", "mail.proton.me"]]
];

BASE.push(
  ["Education", "blue", ["slatetale.com", "coursera.org", "udemy.com", "khanacademy.org", "edx.org", "duolingo.com", "quizlet.com", "skillshare.com", "masterclass.com", "brilliant.org", "codecademy.com", "canvaslms.com", "instructure.com", "blackboard.com", "moodle.org"]],
  ["Design", "pink", ["figma.com", "canva.com", "dribbble.com", "behance.net", "adobe.com", "coolors.co", "unsplash.com", "pexels.com", "framer.com"]],
  ["Finance", "green", ["tradingview.com", "wise.com", "paypal.com", "revolut.com", "interactivebrokers.com", "stripe.com", "coinmarketcap.com", "coingecko.com", "binance.com", "finance.yahoo.com"]],
  ["Business & Marketing", "orange", ["hubspot.com", "salesforce.com", "mailchimp.com", "semrush.com", "ahrefs.com", "analytics.google.com", "ads.google.com", "business.facebook.com", "shopify.com", "business.google.com"]],
  ["Health & Fitness", "green", ["strava.com", "myfitnesspal.com", "fitbit.com", "mayoclinic.org", "webmd.com", "healthline.com", "who.int"]],
  ["Food & Dining", "orange", ["allrecipes.com", "foodnetwork.com", "seriouseats.com", "ubereats.com", "deliveroo.com", "talabat.com", "opentable.com", "zomato.com"]],
  ["Games", "purple", ["steampowered.com", "steamcommunity.com", "epicgames.com", "gog.com", "itch.io", "chess.com", "lichess.org", "roblox.com", "ign.com"]],
  ["Sports", "red", ["espn.com", "skysports.com", "nba.com", "nfl.com", "formula1.com", "fifa.com", "premierleague.com"]],
  ["Home & Property", "orange", ["zillow.com", "rightmove.co.uk", "propertyfinder.ae", "bayut.com", "houzz.com", "realtor.com"]],
  ["Government & Services", "grey", ["u.ae", "gov.uk", "usa.gov", "irs.gov", "icp.gov.ae", "gdrfad.gov.ae"]],
  ["Security & Utilities", "grey", ["1password.com", "bitwarden.com", "lastpass.com", "speedtest.net", "fast.com", "virustotal.com", "haveibeenpwned.com", "timeanddate.com"]],
  ["Communication", "blue", ["whatsapp.com", "telegram.org", "web.telegram.org", "zoom.us", "meet.google.com", "teams.microsoft.com", "signal.org"]]
);

const KEYWORDS = {
  "Developer": "api documentation,api reference,developer tools,source code,pull request,repository,deployments,web hosting,dns records,cloud hosting,database console,kubernetes,programming,javascript,typescript,python tutorial,product analytics,feature flags,session replay,event tracking,developer analytics",
  "AI Apps": "ai assistant,ai chat,ai studio,ai image,ai video,generative ai,large language model,text to image,text to speech,language models,machine learning,chatbot,llm playground",
  "Media": "watch online,watch video,streaming,music player,music streaming,podcast,podcasts,listen online,episodes,playlist",
  "Work": "project management,task management,meeting notes,kanban,todo list,spreadsheets,team workspace,shared documents",
  "Design": "graphic design,design system,wireframe,wireframes,typography,color palette,ui design,ux design,illustration,stock photos,photo editor",
  "Shopping": "add to cart,shopping cart,buy online,online store,free shipping,checkout,product details,shop now",
  "Finance": "stock market,stock price,investment portfolio,online banking,bank account,exchange rate,cryptocurrency,credit card,mutual fund,financial markets",
  "Business & Marketing": "marketing analytics,marketing dashboard,sales dashboard,website analytics,conversion rate,email marketing,search engine optimization,sales pipeline,customer relationship,ad campaigns",
  "Social": "social network,social media,community forum,discussion forum",
  "News": "breaking news,latest news,world news,news headlines,live news,news today",
  "Travel": "book flights,flight booking,flight status,hotel booking,hotel reservation,travel guide,boarding pass,car rental,vacation rentals",
  "Research & Learning": "research paper,research papers,academic research,academic journal,scientific paper,literature review,encyclopedia,scholarly article,reference material",
  "Education": "education app,educational app,education platform,educational platform,online course,online courses,learning platform,learning app,student learning,classroom learning,lesson plan,study tools,language learning,online school,e learning",
  "Mail": "inbox,webmail,email inbox,compose email",
  "Health & Fitness": "workout,workouts,fitness,medical appointment,symptoms,nutrition,patient portal,health clinic,exercise plan",
  "Food & Dining": "recipe,recipes,food delivery,restaurant menu,restaurant reservation,cooking instructions,meal plan",
  "Games": "video game,video games,game store,game walkthrough,gaming,online chess,game review",
  "Sports": "sports scores,football scores,basketball scores,match results,league standings,grand prix,cricket score",
  "Home & Property": "property for sale,property for rent,apartment for rent,real estate,mortgage calculator,interior design,home improvement",
  "Government & Services": "visa application,passport renewal,tax return,government services,driving licence,immigration services",
  "Security & Utilities": "password manager,speed test,unit converter,time zone,malware scan,security scan,vpn dashboard",
  "Communication": "video meeting,video conference,join meeting,team chat,instant messaging"
};

const EMOJIS = {
  "Work": "🗂️",
  "Developer": "💻",
  "AI Apps": "🤖",
  "Shopping": "🛍️",
  "Media": "🎬",
  "Social": "💬",
  "News": "📰",
  "Travel": "✈️",
  "Research & Learning": "🔎",
  "Mail": "✉️",
  "Education": "🎓",
  "Design": "🎨",
  "Finance": "💰",
  "Business & Marketing": "📊",
  "Health & Fitness": "🩺",
  "Food & Dining": "🍽️",
  "Games": "🎮",
  "Sports": "⚽",
  "Home & Property": "🏠",
  "Government & Services": "🏛️",
  "Security & Utilities": "🔐",
  "Communication": "📞"
};

// These are editable starting categories, not a fixed list of groups to create.
export const DEFAULT_CATEGORIES = BASE.map(([title, color, domains]) => ({
  title, color, emoji: EMOJIS[title] || "📁", domains, keywords: (KEYWORDS[title] || "").split(",").filter(Boolean)
}));
