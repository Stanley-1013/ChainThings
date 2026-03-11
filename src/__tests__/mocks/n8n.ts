export function mockN8nWorkflow(id = "wf-1", name = "Test Workflow") {
  return {
    id,
    name: `[ChainThings] ${name}`,
    active: false,
  };
}

export function mockActivatedWorkflow(id = "wf-1", name = "Test Workflow") {
  return {
    ...mockN8nWorkflow(id, name),
    active: true,
  };
}
