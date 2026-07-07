// Системный промпт бота: знания о проекте для диалога через AiGate (DeepSeek 4).
// Текст целиком приходит из site.profile.mjs — core не решает, эксперт перед ним или организация.
import { PROFILE } from '../../site.profile.mjs';

export const SYSTEM_PROMPT = PROFILE.bot.systemPrompt;
