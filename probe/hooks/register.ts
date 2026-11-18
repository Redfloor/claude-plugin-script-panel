// Candidate names for a desktop session-info section (the column holding
// Environment, Context, Connectors). `claude plugin validate` warns
// "no component is named X" for each one the engine lacks; a name it does not
// warn about is new and means a Scripts section may now be possible.
// The validator reads matchers as literals, so one line per name.
const pass = ($: any, e: any, next: any) => next(e)

export const register = (on: any) => {
  on('ui.render', { component: 'SessionInfo' }, pass)
  on('ui.render', { component: 'SessionInfoSection' }, pass)
  on('ui.render', { component: 'SessionPanel' }, pass)
  on('ui.render', { component: 'SessionSidebar' }, pass)
  on('ui.render', { component: 'Sidebar' }, pass)
  on('ui.render', { component: 'SidebarSection' }, pass)
  on('ui.render', { component: 'InfoPanel' }, pass)
  on('ui.render', { component: 'InfoSection' }, pass)
  on('ui.render', { component: 'Section' }, pass)
  on('ui.render', { component: 'Card' }, pass)
  on('ui.render', { component: 'Panel' }, pass)
  on('ui.render', { component: 'Inspector' }, pass)
  on('ui.render', { component: 'RightRail' }, pass)
  on('ui.render', { component: 'Rail' }, pass)
  on('ui.render', { component: 'Environment' }, pass)
  on('ui.render', { component: 'Context' }, pass)
  on('ui.render', { component: 'Connectors' }, pass)
  on('ui.render', { component: 'Outputs' }, pass)
  on('ui.render', { component: 'Widget' }, pass)
  on('ui.render', { component: 'DesktopSection' }, pass)
  on('ui.render', { component: 'DesktopPanel' }, pass)
  on('ui.render', { component: 'DesktopCard' }, pass)
  on('ui.render', { component: 'SidePanel' }, pass)
  on('ui.render', { component: 'Drawer' }, pass)
}
