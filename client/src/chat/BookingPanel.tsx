import { useState } from "react";
import { Link } from "react-router-dom";
import type { Appointment, AppointmentPayload, BookingState } from "./chat.types.ts";
import "./booking.css";

// ─── Helpers ────────────────────────────────────────────────

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;

function isValidCalendarDate(v: string): boolean {
  if (!DATE_RE.test(v)) return false;
  const d = new Date(v + "T00:00:00");
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
}

function isValidTime(v: string): boolean {
  if (!TIME_RE.test(v)) return false;
  const [h, m] = v.split(":").map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
}

function isPast(date: string, time: string): boolean {
  const dt = new Date(`${date}T${time}:00`);
  return dt.getTime() < Date.now();
}

function validatePayload(p: AppointmentPayload): string | null {
  if (!p.service_name.trim()) return "Service name is required";
  if (!isValidCalendarDate(p.appointment_date)) return "Date must be a valid date (YYYY-MM-DD)";
  if (!isValidTime(p.appointment_time)) return "Time must be a valid time (HH:MM)";
  if (isPast(p.appointment_date, p.appointment_time)) return "Cannot book an appointment in the past";
  return null;
}

// ─── Sub-components ─────────────────────────────────────────

function ReviewView({
  prefill,
  onConfirm,
  onEdit,
  onCancel,
}: {
  prefill: AppointmentPayload;
  onConfirm: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="booking">
      <h2 className="booking__heading">Review your appointment</h2>
      <dl className="booking__details">
        <div className="booking__row">
          <dt>Service</dt>
          <dd>{prefill.service_name}</dd>
        </div>
        <div className="booking__row">
          <dt>Date</dt>
          <dd>{formatDate(prefill.appointment_date)}</dd>
        </div>
        <div className="booking__row">
          <dt>Time</dt>
          <dd>{formatTime(prefill.appointment_time)}</dd>
        </div>
      </dl>
      <div className="booking__actions">
        <button type="button" className="booking__btn booking__btn--primary" onClick={onConfirm}>
          Book appointment
        </button>
        <button type="button" className="booking__btn booking__btn--secondary" onClick={onEdit}>
          Edit details
        </button>
        <button type="button" className="booking__btn booking__btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function EditForm({
  prefill,
  error,
  onSubmit,
  onCancel,
}: {
  prefill: Partial<AppointmentPayload>;
  error: string | null;
  onSubmit: (payload: AppointmentPayload) => void;
  onCancel: () => void;
}) {
  const [service, setService] = useState(prefill.service_name ?? "");
  const [date, setDate] = useState(prefill.appointment_date ?? "");
  const [time, setTime] = useState(prefill.appointment_time ?? "");
  const [localError, setLocalError] = useState<string | null>(null);

  const displayError = localError ?? error;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const payload: AppointmentPayload = {
      service_name: service.trim(),
      appointment_date: date,
      appointment_time: time,
    };
    const validationError = validatePayload(payload);
    if (validationError) {
      setLocalError(validationError);
      return;
    }
    setLocalError(null);
    onSubmit(payload);
  }

  return (
    <form className="booking" onSubmit={handleSubmit}>
      <h2 className="booking__heading">Appointment details</h2>

      {displayError && (
        <p className="booking__error" role="alert">{displayError}</p>
      )}

      <div className="booking__field">
        <label className="booking__label" htmlFor="bk-service">Service</label>
        <input
          id="bk-service"
          className="booking__input"
          type="text"
          required
          value={service}
          placeholder="e.g. Haircut, Dental Checkup"
          onChange={(e) => { setService(e.target.value); setLocalError(null); }}
        />
      </div>

      <div className="booking__field">
        <label className="booking__label" htmlFor="bk-date">Date</label>
        <input
          id="bk-date"
          className="booking__input"
          type="date"
          required
          value={date}
          onChange={(e) => { setDate(e.target.value); setLocalError(null); }}
        />
      </div>

      <div className="booking__field">
        <label className="booking__label" htmlFor="bk-time">Time</label>
        <input
          id="bk-time"
          className="booking__input"
          type="time"
          required
          value={time}
          onChange={(e) => { setTime(e.target.value); setLocalError(null); }}
        />
      </div>

      <div className="booking__actions">
        <button type="submit" className="booking__btn booking__btn--primary">
          Book appointment
        </button>
        <button type="button" className="booking__btn booking__btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function SubmittingView() {
  return (
    <div className="booking">
      <p className="booking__status">Booking your appointment…</p>
    </div>
  );
}

function SuccessView({ appointment, onNewBooking, onBackToChat }: {
  appointment: Appointment;
  onNewBooking: () => void;
  onBackToChat: () => void;
}) {
  return (
    <div className="booking">
      <h2 className="booking__heading booking__heading--success">Appointment booked</h2>
      <dl className="booking__details">
        <div className="booking__row">
          <dt>Service</dt>
          <dd>{appointment.service_name}</dd>
        </div>
        <div className="booking__row">
          <dt>Date</dt>
          <dd>{formatDate(appointment.appointment_date)}</dd>
        </div>
        <div className="booking__row">
          <dt>Time</dt>
          <dd>{formatTime(appointment.appointment_time)}</dd>
        </div>
        <div className="booking__row">
          <dt>Status</dt>
          <dd className="booking__value--status">{appointment.status}</dd>
        </div>
      </dl>
      <div className="booking__actions">
        <button type="button" className="booking__btn booking__btn--primary" onClick={onNewBooking}>
          Book another
        </button>
        <button type="button" className="booking__btn booking__btn--secondary" onClick={onBackToChat}>
          Back to chat
        </button>
        <Link to="/" className="booking__btn booking__btn--ghost">Dashboard</Link>
      </div>
    </div>
  );
}

function ErrorView({ message, payload, onRetry, onEdit, onCancel }: {
  message: string;
  payload: AppointmentPayload;
  onRetry: () => void;
  onEdit: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="booking">
      <h2 className="booking__heading">Booking failed</h2>
      <p className="booking__error" role="alert">{message}</p>
      <dl className="booking__details">
        <div className="booking__row">
          <dt>Service</dt>
          <dd>{payload.service_name}</dd>
        </div>
        <div className="booking__row">
          <dt>Date</dt>
          <dd>{formatDate(payload.appointment_date)}</dd>
        </div>
        <div className="booking__row">
          <dt>Time</dt>
          <dd>{formatTime(payload.appointment_time)}</dd>
        </div>
      </dl>
      <div className="booking__actions">
        <button type="button" className="booking__btn booking__btn--primary" onClick={onRetry}>
          Retry
        </button>
        <button type="button" className="booking__btn booking__btn--secondary" onClick={onEdit}>
          Edit details
        </button>
        <button type="button" className="booking__btn booking__btn--ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Main component ─────────────────────────────────────────

export default function BookingPanel({
  booking,
  onBookingChange,
  onSubmit,
}: {
  booking: BookingState;
  onBookingChange: (state: BookingState) => void;
  onSubmit: (payload: AppointmentPayload) => void;
}) {
  switch (booking.step) {
    case "idle":
      return null;

    case "reviewing":
      return (
        <ReviewView
          prefill={booking.prefill}
          onConfirm={() => onSubmit(booking.prefill)}
          onEdit={() => onBookingChange({ step: "editing", prefill: booking.prefill })}
          onCancel={() => onBookingChange({ step: "idle" })}
        />
      );

    case "editing":
      return (
        <EditForm
          prefill={booking.prefill}
          error={null}
          onSubmit={onSubmit}
          onCancel={() => onBookingChange({ step: "idle" })}
        />
      );

    case "submitting":
      return <SubmittingView />;

    case "success":
      return (
        <SuccessView
          appointment={booking.appointment}
          onNewBooking={() => onBookingChange({ step: "editing", prefill: {} })}
          onBackToChat={() => onBookingChange({ step: "idle" })}
        />
      );

    case "error":
      return (
        <ErrorView
          message={booking.message}
          payload={booking.payload}
          onRetry={() => onSubmit(booking.payload)}
          onEdit={() => onBookingChange({ step: "editing", prefill: booking.payload })}
          onCancel={() => onBookingChange({ step: "idle" })}
        />
      );
  }
}
