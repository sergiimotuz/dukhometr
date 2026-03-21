import Anthropic from "@anthropic-ai/sdk";

// Rate limiting storage (in-memory, resets on cold start)
const userRequests = new Map();
const DAILY_LIMIT = 20;

function checkRateLimit(userId) {
  const today = new Date().toDateString();
  const key = `${userId}-${today}`;
  const count = userRequests.get(key) || 0;
  
  if (count >= DAILY_LIMIT) {
    return { allowed: false, remaining: 0 };
  }
  
  userRequests.set(key, count + 1);
  return { allowed: true, remaining: DAILY_LIMIT - count - 1 };
}

export default async function handler(req, res) {
  // Enable CORS
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { messages, systemPrompt, userId } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Invalid request: messages required' });
    }

    // Rate limiting
    const userIdHash = userId || req.headers['x-forwarded-for'] || 'anonymous';
    const rateCheck = checkRateLimit(userIdHash);
    
    if (!rateCheck.allowed) {
      return res.status(429).json({ 
        error: 'Ліміт повідомлень на сьогодні вичерпано. Спробуйте завтра.',
        remainingToday: 0
      });
    }

    // Initialize Anthropic client
    const anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    // Default system prompt for Orthodox spiritual guidance
    const defaultSystemPrompt = `Ти - православний духовний наставник, який добре знає вчення святих отців, Біблію та православну традицію. Відповідай з мудрістю, любов'ю та смиренням. 

Використовуй вчення таких святих як:
- Іоанн Золотоустий
- Василій Великий  
- Григорій Богослов
- Серафим Саровський
- Паїсій Святогорець
- Антоній Великий
- Макарій Єгипетський
- Ісаак Сирін
- Йосип Волоцький
- Максим Сповідник
- інших православних святих і богословів

Давай практичні поради для духовного життя. Будь люблячим та співчутливим. Цитуй Євангеліє та святих отців коли це доречно. Пам'ятай про важливість молитви, покаяння, смирення, любові до ближнього та постійної духовної боротьби.

Відповідай українською мовою коротко та по суті (3-5 речень), але з глибиною та мудрістю. Будь чуйним та обнадійливим.`;

    // Make API call to Claude
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1000,
      system: systemPrompt || defaultSystemPrompt,
      messages: messages
    });

    // Return response with rate limit info
    return res.status(200).json({
      content: response.content,
      remainingToday: rateCheck.remaining,
      usage: response.usage
    });

  } catch (error) {
    console.error('API Error:', error);
    
    if (error.status === 429) {
      return res.status(429).json({ 
        error: 'Сервер перевантажений. Спробуйте через хвилину.' 
      });
    }
    
    return res.status(500).json({ 
      error: 'Помилка сервера. Спробуйте пізніше.',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
}
