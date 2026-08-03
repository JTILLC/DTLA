// shared/components/AppNav.jsx
//
// The app's main navigation, grouped by what each section is ABOUT.
//
// The eight sections look like peers but are not: one belongs to the visit in
// front of you, five belong to the customer and outlive every visit, and two
// are reference. That distinction was previously explained in the help modal —
// a paragraph of prose doing work the layout should do. The group labels do it
// now, so the structure is visible rather than learned.
//
// One row that scrolls sideways, never a row that wraps. Eight tabs on a phone
// used to stack into two or three rows, which pushed the content down the page
// and made the bar the largest thing on screen.
import './app-nav.css';

// The JTI app records a service VISIT; the customer app records a daily LOG.
// Same structure, different noun, so the groups are built rather than fixed —
// and the customer app has a Logins section the JTI app does not.
export const navGroups = ({ noun = 'visit', extras = [] } = {}) => {
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  return [
    {
      label: `This ${noun}`,
      tabs: [
        { key: 'overview', title: 'Overview' },
        { key: 'current', title: `Current ${Noun}` },
      ],
    },
    {
      label: 'This customer',
      tabs: [
        { key: 'span', title: 'Span Adjust' },
        { key: 'boards', title: 'Parts/Boards' },
        { key: 'pm', title: 'PM Log' },
        { key: 'crew', title: 'Crew' },
        ...extras,
        { key: 'activity', title: 'Activity' },
      ],
    },
    {
      label: 'Reference',
      tabs: [
        { key: 'history', title: 'Issue History' },
        { key: 'layout', title: 'Factory Layout' },
      ],
    },
  ];
};

export const NAV_GROUPS = [
  {
    label: 'This visit',
    tabs: [
      { key: 'overview', title: 'Overview' },
      { key: 'current', title: 'Current Visit' },
    ],
  },
  {
    label: 'This customer',
    tabs: [
      { key: 'span', title: 'Span Adjust' },
      { key: 'boards', title: 'Parts/Boards' },
      { key: 'pm', title: 'PM Log' },
      { key: 'crew', title: 'Crew' },
      { key: 'activity', title: 'Activity' },
    ],
  },
  {
    label: 'Reference',
    tabs: [
      { key: 'history', title: 'Issue History' },
      { key: 'layout', title: 'Factory Layout' },
    ],
  },
];

export default function AppNav({ active, onSelect, counts = {}, groups = NAV_GROUPS }) {
  return (
    <div className="ccw-nav" role="tablist" aria-label="Sections">
      {groups.map((group) => (
        <div className="ccw-nav-group" key={group.label}>
          <span className="ccw-nav-label" aria-hidden="true">{group.label}</span>
          <div className="ccw-nav-tabs">
            {group.tabs.map((tab) => {
              // A count is only worth the ink when there is something to answer
              // for; a badge reading 0 is noise on every screen it appears on.
              const count = counts[tab.key];
              return (
                <button
                  key={tab.key}
                  type="button"
                  role="tab"
                  id={`ccw-tab-${tab.key}`}
                  aria-controls={`ccw-pane-${tab.key}`}
                  aria-selected={active === tab.key}
                  className={'ccw-tab' + (active === tab.key ? ' is-active' : '')}
                  onClick={() => onSelect(tab.key)}
                >
                  {tab.title}
                  {count > 0 && (
                    <span className="ccw-tab-count" aria-label={`${count} needing attention`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
