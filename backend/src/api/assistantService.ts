import { GoogleGenAI, Type } from '@google/genai';
import { envConfig } from '../config/env';
import {
  ruleBasedExtractFilters,
  validateAssistantFilters,
  type ValidatedAssistantFilters,
} from '../utils/assistantValidation';

let aiClient: GoogleGenAI | null = null;

function getAiClient(): GoogleGenAI | null {
  if (!envConfig.isGeminiConfigured) return null;
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: envConfig.geminiApiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

export interface AssistantExtractionResult {
  filters: ValidatedAssistantFilters;
  fallback: boolean;
  explanation: string;
}

/**
 * Translates ONE customer message into ONE validated filter object using Gemini (gemini-4-hydrogen)
 * with fixed JSON responseSchema. Never sends the catalogue to Gemini. Retries once on invalid JSON
 * or timeout, then falls back cleanly to rule-based extraction with fallback=true.
 */
export async function extractShoppingFilters(
  message: string,
  knownCategories: string[],
  knownCities: string[],
  options?: { forceInvalidJsonForTest?: boolean }
): Promise<AssistantExtractionResult> {
  const ai = getAiClient();

  if (!ai || options?.forceInvalidJsonForTest) {
    const filters = ruleBasedExtractFilters(message, knownCategories, knownCities);
    return {
      filters,
      fallback: true,
      explanation: options?.forceInvalidJsonForTest
        ? 'Showing normal search results via rule-based filter fallback after invalid model JSON.'
        : 'Showing normal search results using rule-based filter extraction (configure GEMINI_API_KEY for Gemini-assisted filter extraction).',
    };
  }

  const systemInstruction = `You extract structured e-commerce search filters from ONE customer shopping message.
NEVER invent products, prices, ratings, stock counts, or delivery promises.
Allowed categories ONLY: ${knownCategories.join(', ')}.
Allowed cities ONLY: ${knownCities.join(', ')}.
Prices in max_price MUST be in integer PAISE (multiply rupees by 100, e.g., Rs 1000 = 100000).
If the request is vague (e.g. "cheap laptop for college"), do NOT invent a budget — omit max_price.
Treat soft preferences ("good for coding") as soft — omit rather than inventing unsupported categories.
Only populate fields explicitly requested by the customer.`;

  const callGeminiOnce = async (): Promise<ValidatedAssistantFilters> => {
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: message,
      config: {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            q: { type: Type.STRING, description: 'Short product search keyword or phrase' },
            category: { type: Type.STRING, description: 'Exact matching category name if specified' },
            product_type: { type: Type.STRING },
            connectivity: { type: Type.STRING },
            features: { type: Type.ARRAY, items: { type: Type.STRING } },
            max_price: { type: Type.INTEGER, description: 'Maximum price in integer paise (rupees * 100)' },
            max_delivery_days: { type: Type.INTEGER },
            city: { type: Type.STRING, description: 'Exact matching dealer city if specified' },
            delivery_mode: { type: Type.STRING, description: 'quick or standard' },
            sort_preference: {
              type: Type.STRING,
              description: 'One of budget, fastest, rated, value, available',
            },
          },
        },
      },
    });

    const rawText = (response.text ?? '').trim();
    if (!rawText) throw new Error('EMPTY_MODEL_RESPONSE');
    const parsed = JSON.parse(rawText);
    return validateAssistantFilters(parsed, knownCategories, knownCities);
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const filters = await callGeminiOnce();
      return {
        filters,
        fallback: false,
        explanation: 'Extracted structured filters from your query and retrieved live PostgreSQL-verified offers.',
      };
    } catch {
      // Retry once per v7.2 spec
    }
  }

  const fallbackFilters = ruleBasedExtractFilters(message, knownCategories, knownCities);
  return {
    filters: fallbackFilters,
    fallback: true,
    explanation: 'Showing normal search results via rule-based fallback after assistant extraction retry.',
  };
}
