# Full-stack builder context

This language describes the product being built on the existing agent-runtime foundation. It keeps user-facing
application concepts distinct from the computers or cloud runtimes that execute agent work.

## Product and source

**Project**:
A full-stack application a user is building. During the first release, a project belongs to exactly
one execution environment and has one primary source repository.
_Avoid_: App, repo, workspace

**Project Source**:
The durable Git-backed files that define a project.
_Avoid_: Workspace, codebase

**Thread**:
A durable conversation in which a provider works on one project.
_Avoid_: Chat, task, session

**Preview**:
A live, non-production rendering of the project produced by a running development process.
_Avoid_: Deployment, publish

**Deployment**:
A durable published release of a project intended for users outside the builder.
_Avoid_: Preview, dev server

## Execution

**Execution Environment**:
One trusted runtime that owns provider availability, project files, threads, terminals, Git, and
filesystem operations. It may run locally or as a managed environment.
_Avoid_: Server, backend, host

**Local Environment**:
An execution environment running on hardware controlled by the user.
_Avoid_: Desktop project, offline project

**Managed Environment**:
An execution environment provisioned and operated by the product in isolated cloud compute.
_Avoid_: Remote project, hosted client

**Managed Workspace**:
The isolated compute allocation and persistent storage that host one managed environment in the
first release.
_Avoid_: Project, container, VM

**Hosted Client**:
The browser-delivered user interface. It is a client of an execution environment and does not itself
execute providers or project processes.
_Avoid_: Cloud environment, cloud runtime

## Agents

**Provider**:
An agent runtime family such as Codex, Claude, Cursor, or OpenCode.
_Avoid_: Model, harness

**Provider Instance**:
One configured and authenticated installation of a provider within an execution environment.
_Avoid_: Account, provider

**Custom Harness**:
A future provider integration that satisfies the same provider behavior without being one of the
built-in provider families.
_Avoid_: Plugin, script

## Product operations

**Create**:
Establish a project, its source, and the execution environment association needed to begin work.
_Avoid_: Provision, deploy

**Run**:
Start or observe the development processes needed to preview a project.
_Avoid_: Publish, deploy

**Publish**:
Create or update a deployment from project source.
_Avoid_: Run, preview
