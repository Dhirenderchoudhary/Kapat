import { sValidator } from "@hono/standard-validator"
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { z } from "zod"

import { ApiError, validationErrorResponses } from "@/lib/error"
import { sarvamKey, synthesizeSpeech, transcribeSpeech } from "@/lib/sarvam"
import {
  parseReply,
  scriptFor,
  VOICE_LANGUAGES,
  VOICE_ROLES,
  VOICE_TURNS,
} from "@/lib/voice-scripts"

const languageSchema = z.enum(VOICE_LANGUAGES)
const roleSchema = z.enum(VOICE_ROLES)

const speakSchema = z.object({
  language: languageSchema,
  role: roleSchema.default("merchant"),
  turn: z.enum(VOICE_TURNS).default("opening"),
  outcome: z.string().optional(),
})

const listenSchema = z.object({
  language: languageSchema,
  role: roleSchema.default("merchant"),
  audioBase64: z.string().min(1),
  mimeType: z.string().default("audio/wav"),
})

const audioData = z.object({
  audioBase64: z.string(),
  mimeType: z.literal("audio/wav"),
  text: z.string(),
  outcome: z.string().optional(),
  transcript: z.string().optional(),
})

export const voiceRouter = new Hono()
  .get(
    "/",
    describeRoute({
      tags: ["Voice"],
      description: "Whether Sarvam TTS/STT is configured on this API process.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": {
              schema: resolver(z.object({ data: z.object({ configured: z.boolean() }) })),
            },
          },
        },
      },
    }),
    (c) => c.json({ data: { configured: Boolean(sarvamKey()) } }),
  )
  .post(
    "/speak",
    describeRoute({
      tags: ["Voice"],
      description:
        "Synthesize one agent line with Sarvam Bulbul v3 (English, Hindi, or Marathi). Does not cancel or capture a payment; it only speaks.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: audioData })) },
          },
        },
        ...validationErrorResponses,
      },
    }),
    sValidator("json", speakSchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid voice request", {
          issues: result.error,
        })
      }
    }),
    async (c) => {
      const { language, role, turn, outcome } = c.req.valid("json")
      const text = scriptFor(role, language, turn, outcome)
      const audioBase64 = await synthesizeSpeech(text, language)
      return c.json({ data: { audioBase64, mimeType: "audio/wav" as const, text } })
    },
  )
  .post(
    "/listen",
    describeRoute({
      tags: ["Voice"],
      description:
        "Transcribe a spoken reply with Sarvam Saaras and map it to a merchant cancel/release or a customer confirm/deny. Never executes the payment action.",
      responses: {
        200: {
          description: "OK",
          content: {
            "application/json": { schema: resolver(z.object({ data: audioData })) },
          },
        },
        ...validationErrorResponses,
      },
    }),
    sValidator("json", listenSchema, (result) => {
      if (!result.success) {
        throw new ApiError(400, "VALIDATION_ERROR", "Invalid listen request", {
          issues: result.error,
        })
      }
    }),
    async (c) => {
      const { language, role, audioBase64, mimeType } = c.req.valid("json")
      const transcript = await transcribeSpeech(audioBase64, mimeType, language)
      const outcome = parseReply(role, transcript)
      const closing = scriptFor(role, language, "closing", outcome)
      const replyAudio = await synthesizeSpeech(closing, language)
      return c.json({
        data: {
          audioBase64: replyAudio,
          mimeType: "audio/wav" as const,
          text: closing,
          outcome,
          transcript,
        },
      })
    },
  )
