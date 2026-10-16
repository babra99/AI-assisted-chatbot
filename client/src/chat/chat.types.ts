export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
};

export type AppointmentExtraction = {
  service_name?: string;
  appointment_date?: string;
  appointment_time?: string;
};

export type ChatReply = {
  appointment: AppointmentExtraction;
  message: string;
  missing_fields: string[];
  ready: boolean;
};

export type ChatSession = {
  id: string;
  user_id: string;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
};

export type ChatSessionSummary = {
  id: string;
  user_id: string;
  message_count: number;
  created_at: string;
  updated_at: string;
};

/** Local UI message — extends stored message with optional reply metadata. */
export type DisplayMessage = {
  role: "user" | "assistant";
  content: string;
  at: string;
  reply?: ChatReply;
};

export type SendState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "error"; message: string; failedText: string };

/** Fields accepted by POST /api/appointments. */
export type AppointmentPayload = {
  service_name: string;
  appointment_date: string;
  appointment_time: string;
};

/** Row returned by the appointments API. */
export type Appointment = {
  id: string;
  user_id: string;
  service_name: string;
  appointment_date: string;
  appointment_time: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type BookingState =
  | { step: "idle" }
  | { step: "reviewing"; prefill: AppointmentPayload }
  | { step: "editing"; prefill: Partial<AppointmentPayload> }
  | { step: "submitting"; payload: AppointmentPayload }
  | { step: "success"; appointment: Appointment }
  | { step: "error"; payload: AppointmentPayload; message: string };
