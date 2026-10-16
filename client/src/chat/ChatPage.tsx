import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiRequest } from "../api/api.client.ts";
import type {
  Appointment,
  AppointmentPayload,
  BookingState,
  ChatReply,
  ChatSession,
  DisplayMessage,
  SendState,
} from "./chat.types.ts";
import BookingPanel from "./BookingPanel.tsx";
import "./chat.css";

const SESSION_KEY = "chat_session_id";

function formatDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y}`;
}

function formatTime(hhmm: string): string {
  const [hStr, mStr] = hhmm.split(":");
  const h = Number(hStr);
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${mStr} ${suffix}`;
}

function replyToPrefill(reply: ChatReply): Partial<AppointmentPayload> {
  const p: Partial<AppointmentPayload> = {};
  if (reply.appointment.service_name) p.service_name = reply.appointment.service_name;
  if (reply.appointment.appointment_date) p.appointment_date = reply.appointment.appointment_date;
  if (reply.appointment.appointment_time) p.appointment_time = reply.appointment.appointment_time;
  return p;
}

// ─── Appointment card (inside messages) ──────────────────────

function AppointmentCard({
  reply,
  onConfirm,
}: {
  reply: ChatReply;
  onConfirm: ((prefill: AppointmentPayload) => void) | null;
}) {
  const { appointment, ready } = reply;
  const hasAny = appointment.service_name || appointment.appointment_date || appointment.appointment_time;
  if (!hasAny) return null;

  return (
    <div className={`appt-card${ready ? " appt-card--ready" : ""}`}>
      <p className="appt-card__title">{ready ? "Ready to book" : "Appointment details"}</p>
      <div className="appt-card__row">
        <span className="appt-card__label">Service</span>
        {appointment.service_name
          ? <span className="appt-card__value">{appointment.service_name}</span>
          : <span className="appt-card__value appt-card__value--missing">not specified</span>}
      </div>
      <div className="appt-card__row">
        <span className="appt-card__label">Date</span>
        {appointment.appointment_date
          ? <span className="appt-card__value">{formatDate(appointment.appointment_date)}</span>
          : <span className="appt-card__value appt-card__value--missing">not specified</span>}
      </div>
      <div className="appt-card__row">
        <span className="appt-card__label">Time</span>
        {appointment.appointment_time
          ? <span className="appt-card__value">{formatTime(appointment.appointment_time)}</span>
          : <span className="appt-card__value appt-card__value--missing">not specified</span>}
      </div>
      {ready && onConfirm && appointment.service_name && appointment.appointment_date && appointment.appointment_time && (
        <button
          type="button"
          className="appt-card__confirm"
          onClick={() => onConfirm({
            service_name: appointment.service_name!,
            appointment_date: appointment.appointment_date!,
            appointment_time: appointment.appointment_time!,
          })}
        >
          Confirm booking
        </button>
      )}
    </div>
  );
}

// ─── ChatPage ────────────────────────────────────────────────

type InitState =
  | { status: "loading" }
  | { status: "ready"; sessionId: string }
  | { status: "error"; message: string };

export default function ChatPage() {
  const [init, setInit] = useState<InitState>({ status: "loading" });
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [send, setSend] = useState<SendState>({ status: "idle" });
  const [input, setInput] = useState("");
  const [booking, setBooking] = useState<BookingState>({ step: "idle" });
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, send, scrollToBottom]);

  // --- Session init: restore or create ---
  useEffect(() => {
    let cancelled = false;

    async function initSession() {
      const storedId = sessionStorage.getItem(SESSION_KEY);
      if (storedId) {
        const result = await apiRequest<{ session: ChatSession }>(`/api/chat/${storedId}`);
        if (cancelled) return;
        if (result.ok) {
          const restored: DisplayMessage[] = result.data.session.messages.map((m) => ({
            role: m.role,
            content: m.content,
            at: m.at,
          }));
          setMessages(restored);
          setInit({ status: "ready", sessionId: storedId });
          return;
        }
        sessionStorage.removeItem(SESSION_KEY);
      }

      const result = await apiRequest<{ session: ChatSession }>("/api/chat", {
        method: "POST",
      });
      if (cancelled) return;
      if (result.ok) {
        sessionStorage.setItem(SESSION_KEY, result.data.session.id);
        setInit({ status: "ready", sessionId: result.data.session.id });
      } else {
        setInit({ status: "error", message: result.error });
      }
    }

    void initSession();
    return () => { cancelled = true; };
  }, []);

  // --- Send a chat message ---
  const sendMessage = useCallback(async (text: string) => {
    if (init.status !== "ready") return;

    const userMsg: DisplayMessage = {
      role: "user",
      content: text,
      at: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);
    setSend({ status: "sending" });
    setInput("");

    const result = await apiRequest<{ reply: ChatReply }>(
      `/api/chat/${init.sessionId}/messages`,
      { method: "POST", body: JSON.stringify({ text }) },
    );

    if (result.ok) {
      const assistantMsg: DisplayMessage = {
        role: "assistant",
        content: result.data.reply.message,
        at: new Date().toISOString(),
        reply: result.data.reply,
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setSend({ status: "idle" });
    } else {
      setSend({ status: "error", message: result.error, failedText: text });
    }
  }, [init]);

  // --- Submit appointment to the API ---
  const submitBooking = useCallback(async (payload: AppointmentPayload) => {
    setBooking({ step: "submitting", payload });

    const result = await apiRequest<{ appointment: Appointment }>("/api/appointments", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    if (result.ok) {
      setBooking({ step: "success", appointment: result.data.appointment });
    } else {
      setBooking({ step: "error", payload, message: result.error });
    }
  }, []);

  function handleConfirmFromChat(prefill: AppointmentPayload) {
    setBooking({ step: "reviewing", prefill });
  }

  function handleBookManually() {
    // Pre-fill from the latest assistant reply that has any appointment data
    const lastReply = [...messages].reverse().find((m) => m.reply)?.reply;
    const prefill = lastReply ? replyToPrefill(lastReply) : {};
    setBooking({ step: "editing", prefill });
  }

  function handleRetry() {
    if (send.status !== "error") return;
    const text = send.failedText;
    setMessages((prev) => prev.slice(0, -1));
    void sendMessage(text);
  }

  function handleDismissError() {
    setSend({ status: "idle" });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.trim();
    if (!text || send.status === "sending") return;
    void sendMessage(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = input.trim();
      if (!text || send.status === "sending") return;
      void sendMessage(text);
    }
  }

  function handleNewChat() {
    if (init.status !== "ready") return;
    sessionStorage.removeItem(SESSION_KEY);
    setMessages([]);
    setSend({ status: "idle" });
    setBooking({ step: "idle" });
    setInit({ status: "loading" });

    async function create() {
      const result = await apiRequest<{ session: ChatSession }>("/api/chat", {
        method: "POST",
      });
      if (result.ok) {
        sessionStorage.setItem(SESSION_KEY, result.data.session.id);
        setInit({ status: "ready", sessionId: result.data.session.id });
      } else {
        setInit({ status: "error", message: result.error });
      }
    }
    void create();
  }

  // --- Init loading / error ---
  if (init.status === "loading") {
    return (
      <div className="chat">
        <div className="chat__init">
          <p className="status status--loading">Starting chat…</p>
        </div>
      </div>
    );
  }

  if (init.status === "error") {
    return (
      <div className="chat">
        <div className="chat__init">
          <p className="chat__init-error" role="alert">{init.message}</p>
          <button type="button" className="retry" onClick={() => {
            setInit({ status: "loading" });
            sessionStorage.removeItem(SESSION_KEY);
            async function retry() {
              const result = await apiRequest<{ session: ChatSession }>("/api/chat", {
                method: "POST",
              });
              if (result.ok) {
                sessionStorage.setItem(SESSION_KEY, result.data.session.id);
                setInit({ status: "ready", sessionId: result.data.session.id });
              } else {
                setInit({ status: "error", message: result.error });
              }
            }
            void retry();
          }}>
            Retry
          </button>
          <Link to="/" className="chat__back">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  const sending = send.status === "sending";
  const bookingActive = booking.step !== "idle";

  return (
    <div className="chat">
      <header className="chat__header">
        <h1 className="chat__title">Book an appointment</h1>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          {!bookingActive && (
            <button type="button" className="chat__back" onClick={handleBookManually}>
              Book manually
            </button>
          )}
          <button type="button" className="chat__back" onClick={handleNewChat}>
            New chat
          </button>
          <Link to="/" className="chat__back">Dashboard</Link>
        </div>
      </header>

      <div className="chat__messages" role="log" aria-live="polite">
        {messages.length === 0 && (
          <div className="chat__empty">
            Describe the appointment you&apos;d like to book — include the service, date, and time.
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`msg msg--${msg.role}`}>
            <p>{msg.content}</p>
            {msg.reply && (
              <AppointmentCard
                reply={msg.reply}
                onConfirm={bookingActive ? null : handleConfirmFromChat}
              />
            )}
          </div>
        ))}
        {sending && (
          <div className="chat__thinking" aria-label="Assistant is thinking">
            <span className="chat__dot" />
            <span className="chat__dot" />
            <span className="chat__dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {send.status === "error" && (
        <div className="chat__error" role="alert">
          <span className="chat__error-text">{send.message}</span>
          <button type="button" className="chat__retry" onClick={handleRetry}>
            Retry
          </button>
          <button type="button" className="chat__retry" onClick={handleDismissError}>
            Dismiss
          </button>
        </div>
      )}

      {bookingActive ? (
        <BookingPanel
          booking={booking}
          onBookingChange={setBooking}
          onSubmit={(payload) => void submitBooking(payload)}
        />
      ) : (
        <form className="chat__input-area" onSubmit={handleSubmit}>
          <textarea
            ref={inputRef}
            className="chat__input"
            rows={1}
            placeholder="Type your message…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={sending}
            aria-label="Message"
          />
          <button
            type="submit"
            className="chat__send"
            disabled={sending || !input.trim()}
          >
            Send
          </button>
        </form>
      )}
    </div>
  );
}
