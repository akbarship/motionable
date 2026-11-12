/** Uzbek display text for provider error codes; unknown codes pass through unchanged. */
const TEXTS: Record<string, string> = {
  elevenlabs_payment_issue: "ElevenLabs hisobingizda to'lanmagan to'lov bor. Invoice'ni to'lang, keyin subtitr ishlaydi.",
  elevenlabs_bad_key: "ElevenLabs kaliti noto'g'ri.",
  insufficient_balance: 'Balans yetarli emas.',
  no_bot_key: 'Bot kaliti kiritilmagan.',
  bad_bot_url: "Bot manzili noto'g'ri.",
};

export function errorText(code: string): string {
  return Object.hasOwn(TEXTS, code) ? TEXTS[code] : code;
}
