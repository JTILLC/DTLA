import React, { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Trash2, X, Edit2 } from "lucide-react";
import { deleteTimesheetEntry } from "../data-service";

export default function CalendarView({ events, currentMonth, setCurrentMonth, colors, darkMode, onRefresh }) {
  const [selectedDay, setSelectedDay] = useState(null);
  const [dayEvents, setDayEvents] = useState([]);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Handle delete entry
  const handleDelete = async (event) => {
    setDeleting(true);
    try {
      await deleteTimesheetEntry(event.id, event.date);
      // Remove from local state
      setDayEvents(prev => prev.filter(e => !(e.id === event.id && e.date === event.date)));
      setDeleteConfirm(null);
      // Refresh calendar events
      if (onRefresh) onRefresh();
    } catch (error) {
      alert('Failed to delete entry: ' + error.message);
    }
    setDeleting(false);
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // Get days in month
  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDay = firstDay.getDay();
    return { daysInMonth, startingDay };
  };

  // Navigate months
  const prevMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1));
  };

  const nextMonth = () => {
    setCurrentMonth(new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1));
  };

  // Build year list from event data (so old docx visits and any future ones
  // are reachable). Always include the current year and a one-year buffer.
  const yearOptions = (() => {
    const set = new Set();
    const thisYear = new Date().getFullYear();
    set.add(thisYear);
    set.add(thisYear + 1);
    events.forEach((ev) => {
      const y = parseInt((ev.date || '').slice(0, 4), 10);
      if (y) set.add(y);
    });
    set.add(currentMonth.getFullYear());
    return [...set].sort((a, b) => a - b);
  })();

  const handleMonthChange = (e) => {
    const newMonth = parseInt(e.target.value, 10);
    setCurrentMonth(new Date(currentMonth.getFullYear(), newMonth, 1));
  };

  const handleYearChange = (e) => {
    const newYear = parseInt(e.target.value, 10);
    setCurrentMonth(new Date(newYear, currentMonth.getMonth(), 1));
  };

  const goToToday = () => setCurrentMonth(new Date());

  // Get events for a specific date
  const getEventsForDate = (day) => {
    const dateStr = `${currentMonth.getFullYear()}-${String(currentMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return events.filter(event => event.date === dateStr);
  };

  // Handle day click - allow clicking any day
  const handleDayClick = (day) => {
    const evts = getEventsForDate(day);
    setSelectedDay(day);
    setDayEvents(evts);
  };

  const { daysInMonth, startingDay } = getDaysInMonth(currentMonth);

  return (
    <div>
      {/* Calendar Header */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '20px'
      }}>
        <button
          onClick={prevMonth}
          style={{
            padding: '8px 12px',
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            cursor: 'pointer',
            color: colors.text
          }}
        >
          <ChevronLeft size={20} />
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', justifyContent: 'center' }}>
          <select
            value={currentMonth.getMonth()}
            onChange={handleMonthChange}
            style={{
              padding: '8px 10px',
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              color: colors.text,
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            {monthNames.map((name, i) => (
              <option key={name} value={i}>{name}</option>
            ))}
          </select>
          <select
            value={currentMonth.getFullYear()}
            onChange={handleYearChange}
            style={{
              padding: '8px 10px',
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              color: colors.text,
              fontSize: '16px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={goToToday}
            style={{
              padding: '7px 12px',
              background: colors.cardBg,
              border: `1px solid ${colors.border}`,
              borderRadius: '6px',
              cursor: 'pointer',
              color: colors.text,
              fontSize: '13px',
              fontWeight: '500'
            }}
          >
            Today
          </button>
        </div>
        <button
          onClick={nextMonth}
          style={{
            padding: '8px 12px',
            background: colors.cardBg,
            border: `1px solid ${colors.border}`,
            borderRadius: '6px',
            cursor: 'pointer',
            color: colors.text
          }}
        >
          <ChevronRight size={20} />
        </button>
      </div>

      {/* Day Names */}
      <div className="calendar-day-names">
        {dayNames.map(day => (
          <div key={day} className="calendar-day-name" style={{
            color: colors.textSecondary
          }}>
            {day}
          </div>
        ))}
      </div>

      {/* Calendar Grid */}
      <div className="calendar-grid">
        {/* Empty cells for days before start of month */}
        {Array.from({ length: startingDay }).map((_, i) => (
          <div key={`empty-${i}`} className="calendar-day-cell" style={{
            background: colors.cardBg,
            opacity: 0.3
          }} />
        ))}

        {/* Days of the month */}
        {Array.from({ length: daysInMonth }).map((_, i) => {
          const day = i + 1;
          const dayEvents = getEventsForDate(day);
          const hasEvents = dayEvents.length > 0;
          const isToday = new Date().toDateString() === new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day).toDateString();

          return (
            <div
              key={day}
              onClick={() => handleDayClick(day)}
              className="calendar-day-cell"
              style={{
                background: hasEvents ? (darkMode ? '#1e3a5f' : '#e0f2fe') : colors.cardBg,
                border: isToday ? '2px solid #3b82f6' : `1px solid ${colors.border}`
              }}
            >
              <div className="calendar-day-number" style={{
                fontWeight: isToday ? '700' : '500',
                color: isToday ? '#3b82f6' : colors.text
              }}>
                {day}
              </div>
              {hasEvents && (
                <div style={{ color: colors.textSecondary, overflow: 'hidden' }}>
                  {(() => {
                    const seen = new Set();
                    const uniques = [];
                    dayEvents.forEach((ev) => {
                      const key = ev.customer + '|' + (ev.type || '');
                      if (seen.has(key)) return;
                      seen.add(key);
                      uniques.push(ev);
                    });
                    return (
                      <>
                        {uniques.slice(0, 2).map((ev, i) => (
                          <div key={i} className="calendar-event-preview">
                            <div style={{ fontWeight: 600, color: colors.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {ev.customer}
                            </div>
                            {ev.type === 'doc' && ev.rangeDisplay && (
                              <div style={{ fontSize: '10px', opacity: 0.75 }}>{ev.rangeDisplay}</div>
                            )}
                          </div>
                        ))}
                        {uniques.length > 2 && (
                          <div className="calendar-event-preview">+{uniques.length - 2} more</div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Selected Day Events Modal */}
      {selectedDay && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1000
        }}
        onClick={() => setSelectedDay(null)}
        >
          <div
            style={{
              background: colors.cardBg,
              borderRadius: '12px',
              padding: '24px',
              maxWidth: '500px',
              width: '90%',
              maxHeight: '80vh',
              overflow: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginBottom: '16px'
            }}>
              <h3 style={{ fontSize: '18px', fontWeight: '600', color: colors.text }}>
                {monthNames[currentMonth.getMonth()]} {selectedDay}, {currentMonth.getFullYear()}
              </h3>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                <button
                  onClick={() => {
                    window.open('https://jti-timesheet.pages.dev/', '_blank');
                  }}
                  style={{
                    padding: '6px 10px',
                    fontSize: '12px',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px'
                  }}
                >
                  <Plus size={14} /> Add
                </button>
                <button
                  onClick={() => setSelectedDay(null)}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: colors.textSecondary
                  }}
                >
                  <X size={20} />
                </button>
              </div>
            </div>

            {dayEvents.length === 0 ? (
              <div style={{
                textAlign: 'center',
                padding: '24px',
                color: colors.textSecondary
              }}>
                <p style={{ marginBottom: '12px' }}>No entries for this day</p>
                <button
                  onClick={() => {
                    window.open('https://jti-timesheet.pages.dev/', '_blank');
                  }}
                  style={{
                    padding: '8px 16px',
                    fontSize: '13px',
                    background: '#10b981',
                    color: 'white',
                    border: 'none',
                    borderRadius: '6px',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  <Plus size={16} /> Add Entry
                </button>
              </div>
            ) : (
              dayEvents.map((event, index) => (
                <div
                  key={index}
                  style={{
                    padding: '12px',
                    background: darkMode ? '#374151' : '#f3f4f6',
                    borderRadius: '8px',
                    marginBottom: '8px',
                    borderLeft: `4px solid ${
                      event.type === 'onsite'
                        ? '#f59e0b'
                        : event.type === 'doc'
                          ? '#8b5cf6'
                          : '#10b981'
                    }`
                  }}
                >
                  {event.type === 'doc' && event.rangeDisplay && (
                    <div style={{ fontWeight: 700, color: colors.text, marginBottom: '4px', fontSize: '14px' }}>
                      {event.rangeDisplay}
                    </div>
                  )}
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '4px'
                  }}>
                    <div style={{
                      fontWeight: '600',
                      color: colors.text
                    }}>
                      {event.customer}
                    </div>
                    {event.type === 'doc' && (
                      <span style={{
                        fontSize: '10px',
                        padding: '2px 6px',
                        background: '#ede9fe',
                        color: '#5b21b6',
                        borderRadius: '4px',
                        fontWeight: '600'
                      }}>
                        Archive
                      </span>
                    )}
                    {event.type === 'onsite' && (
                      <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {event.status && (
                          <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            background: event.status.toLowerCase() === 'offline' ? '#fee2e2' : '#d1fae5',
                            color: event.status.toLowerCase() === 'offline' ? '#991b1b' : '#065f46',
                            borderRadius: '4px',
                            fontWeight: '500'
                          }}>
                            {event.status}
                          </span>
                        )}
                        {event.repairStatus && (
                          <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            background: '#dbeafe',
                            color: '#1e40af',
                            borderRadius: '4px',
                            fontWeight: '500'
                          }}>
                            {event.repairStatus}
                          </span>
                        )}
                        {!event.status && !event.repairStatus && (
                          <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            background: '#fef3c7',
                            color: '#92400e',
                            borderRadius: '4px',
                            fontWeight: '500'
                          }}>
                            Onsite
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  {event.visitName && (
                    <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>
                      {event.visitName}
                    </div>
                  )}
                  {event.hours > 0 && (
                    <div style={{ fontSize: '12px', color: colors.textSecondary }}>
                      {event.hours} hours
                    </div>
                  )}
                  {event.type === 'doc' && (event.city || event.state || event.period) && (
                    <div style={{ fontSize: '12px', color: colors.textSecondary, marginBottom: '4px' }}>
                      {[event.city, event.state].filter(Boolean).join(', ')}
                      {event.city && event.period && ' · '}
                      {event.period}
                    </div>
                  )}
                  {event.type === 'doc' && Array.isArray(event.fullBody) && event.fullBody.length > 0 ? (
                    <div style={{
                      fontSize: '12px',
                      color: colors.textSecondary,
                      marginTop: '8px',
                      padding: '10px 12px',
                      background: darkMode ? '#1f2937' : 'white',
                      borderRadius: '4px',
                      maxHeight: '320px',
                      overflowY: 'auto',
                      lineHeight: 1.55,
                    }}>
                      {event.fullBody.map((line, i) => (
                        <p key={i} style={{ margin: i === 0 ? 0 : '6px 0 0' }}>{line}</p>
                      ))}
                    </div>
                  ) : event.serviceWork ? (
                    <div style={{
                      fontSize: '12px',
                      color: colors.textSecondary,
                      marginTop: '8px',
                      padding: '8px',
                      background: darkMode ? '#1f2937' : 'white',
                      borderRadius: '4px',
                      maxHeight: '320px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}>
                      {event.serviceWork}
                    </div>
                  ) : null}
                  {event.type !== 'onsite' && (
                    <div style={{
                      display: 'flex',
                      gap: '8px',
                      marginTop: '8px'
                    }}>
                      <button
                        onClick={() => {
                          if (event.id) {
                            window.open(`https://jti-timesheet.pages.dev/?id=${event.id}`, '_blank');
                          }
                        }}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          background: '#3b82f6',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Edit2 size={12} /> Edit
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(event)}
                        style={{
                          padding: '4px 8px',
                          fontSize: '11px',
                          background: '#ef4444',
                          color: 'white',
                          border: 'none',
                          borderRadius: '4px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  )}
                  {event.type === 'onsite' && (
                    <div style={{
                      marginTop: '8px',
                      fontSize: '11px',
                      color: colors.textSecondary
                    }}>
                      From Shearers Head History
                    </div>
                  )}
                </div>
              ))
            )}

            {/* Delete Confirmation Dialog */}
            {deleteConfirm && (
              <div style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(0,0,0,0.7)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1001
              }}>
                <div style={{
                  background: colors.cardBg,
                  borderRadius: '12px',
                  padding: '24px',
                  maxWidth: '400px',
                  width: '90%'
                }}>
                  <h4 style={{ fontSize: '16px', fontWeight: '600', color: colors.text, marginBottom: '12px' }}>
                    Delete Entry?
                  </h4>
                  <p style={{ fontSize: '14px', color: colors.textSecondary, marginBottom: '16px' }}>
                    Are you sure you want to delete this entry for <strong>{deleteConfirm.customer}</strong> on {deleteConfirm.date}?
                  </p>
                  <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                    <button
                      onClick={() => setDeleteConfirm(null)}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        background: colors.cardBg,
                        color: colors.text,
                        border: `1px solid ${colors.border}`,
                        borderRadius: '6px',
                        cursor: 'pointer'
                      }}
                      disabled={deleting}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleDelete(deleteConfirm)}
                      style={{
                        padding: '8px 16px',
                        fontSize: '13px',
                        background: '#ef4444',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        opacity: deleting ? 0.7 : 1
                      }}
                      disabled={deleting}
                    >
                      {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
