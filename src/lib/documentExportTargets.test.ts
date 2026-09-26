import { describe, it, expect } from 'vitest';
import { documentExportTargets } from './documentExportTargets';
const folders = [
  {path:'Work',name:'Work',parent_path:''},
  {path:'Work/Projects',name:'Projects',parent_path:'Work'},
  {path:'Personal',name:'Personal',parent_path:''},
];
const note = {path:'Work/Projects/Plan.md',title:'Plan',parent_path:'Work/Projects'};
describe('File export selection', () => {
  it('exports the open note, its nested folder and the full current section', () => {
    expect(documentExportTargets('Notebook','section-view','Work',note,folders)).toEqual({
      note:{kind:'note',path:note.path}, folder:{kind:'folder',path:'Work/Projects'}, section:{kind:'folder',path:'Work',source:'sections-pane'},
    });
  });
  it('does not treat a section itself as a selected folder', () => {
    const targets = documentExportTargets('Notebook','section-view','Work',null,folders);
    expect(targets.folder).toBeUndefined(); expect(targets.note).toBeUndefined(); expect(targets.section?.path).toBe('Work');
  });
  it.each(['dual-pane','single-pane'] as const)('omits section targets in %s and follows the selected folder', style => {
    const targets = documentExportTargets('Notebook',style,'Personal',note,folders);
    expect(targets.section).toBeUndefined(); expect(targets.folder?.path).toBe('Personal');
  });
  it('limits Uncategorized to notes directly in the notebook root', () => {
    expect(documentExportTargets('Notebook','section-view','',null,folders)).toEqual({section:{kind:'folder',path:'',source:'sections-pane'}});
  });
  it('disables targets without a notebook or selected folder', () => {
    expect(documentExportTargets('','section-view','Work',note,folders)).toEqual({});
    expect(documentExportTargets('Notebook','dual-pane','',null,folders)).toEqual({});
    expect(documentExportTargets('Notebook','dual-pane','Deleted',null,folders)).toEqual({});
  });
});
