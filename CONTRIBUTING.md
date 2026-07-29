# Contributing to PetChain Mobile App

Thank you for your interest in contributing to **PetChain**! We welcome contributions from the community. This guide will help you get started with setting up the project, understanding the branch strategy, submitting pull requests, and following coding standards.

---

## Table of Contents

- [Project Setup](#project-setup)
- [Branch Naming Convention](#branch-naming-convention)
- [Development Workflow](#development-workflow)
- [Commit Message Convention](#commit-message-convention)
- [Pull Request Process](#pull-request-process)
- [Coding Standards](#coding-standards)
- [Testing](#testing)
- [Linting and Formatting](#linting-and-formatting)
- [Issue Labelling](#issue-labelling)
- [Getting Help](#getting-help)

---

## Project Setup

### Prerequisites

- **Node.js** >= 18
- **npm** >= 9
- **Expo CLI**: `npm install -g expo-cli`
- **Android Studio** or **Xcode** (for emulators/simulators)
- **Docker** (for running the backend locally)

### Local Development Setup

1. **Clone the repository:**

   ```bash
   git clone https://github.com/DogStark/PetChain-MobileApp.git
   cd PetChain-MobileApp
   ```

2. **Install dependencies:**

   ```bash
   npm install --legacy-peer-deps
   ```

3. **Set up environment variables:**

   Copy the example environment file and adjust as needed:

   ```bash
   cp .env.example .env
   ```

4. **Start the development server:**

   ```bash
   npm start
   ```

5. **Run the backend (optional, for full-stack development):**

   ```bash
   docker-compose up -d
   npm run server
   ```

---

## Branch Naming Convention

We follow a structured branch naming convention to keep the repository organized:

| Prefix       | Purpose                                    | Example                          |
|-------------|--------------------------------------------|----------------------------------|
| `feat/`      | New features                               | `feat/add-pet-profile-qr`        |
| `fix/`       | Bug fixes                                  | `fix/medication-reminder-crash`  |
| `docs/`      | Documentation changes                      | `docs/update-api-readme`         |
| `refactor/`  | Code refactoring without feature changes   | `refactor/cleanup-auth-service`  |
| `test/`      | Adding or updating tests                   | `test/add-error-utils-tests`     |
| `chore/`     | Maintenance tasks, CI, dependencies        | `chore/update-expo-version`      |
| `style/`     | Code style changes (formatting, etc.)      | `style/format-validators`        |
| `perf/`      | Performance improvements                   | `perf/optimize-image-loading`    |
| `ci/`        | CI/CD configuration changes                | `ci/add-e2e-workflow`            |

Branch names should be:
- All lowercase
- Use hyphens (`-`) as word separators
- Be descriptive but concise

---

## Development Workflow

1. **Pick an issue** from the GitHub Issues page and assign it to yourself.
2. **Create a new branch** from `main` following the naming convention:
   ```bash
   git checkout -b feat/my-feature-branch
   ```
3. **Make your changes** following the coding standards below.
4. **Write or update tests** as needed.
5. **Run linting and tests locally** before committing:
   ```bash
   npm run lint
   npm test
   ```
6. **Commit your changes** using [Conventional Commits](#commit-message-convention).
7. **Push your branch** and open a Pull Request.

---

## Commit Message Convention

This project enforces **Conventional Commits** via [commitlint](https://commitlint.js.org/) and [Husky](https://typicode.github.io/husky/).

### Format

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Allowed Types

| Type       | Usage                                      |
|------------|--------------------------------------------|
| `feat`     | A new feature                              |
| `fix`      | A bug fix                                  |
| `docs`     | Documentation only changes                 |
| `style`    | Code style changes (formatting, etc.)      |
| `refactor` | Code refactoring                           |
| `perf`     | Performance improvements                   |
| `test`     | Adding or updating tests                   |
| `build`    | Build system or dependency changes         |
| `ci`       | CI/CD configuration changes                |
| `chore`    | Maintenance tasks                          |
| `revert`   | Reverting a previous commit                |

### Examples

```
feat(auth): add biometric authentication support
fix(sync): resolve data race in background sync
docs(readme): update installation instructions
test(utils): add unit tests for validators
chore(deps): upgrade expo to version 56
```

**Note:** Commit hooks will automatically validate your commit messages. If a commit message does not follow the convention, the commit will be rejected.

---

## Pull Request Process

1. **Ensure your branch is up to date** with `main`:
   ```bash
   git fetch upstream
   git rebase upstream/main
   ```

2. **Create a Pull Request** on GitHub from your branch to `main`.

3. **Fill out the PR template** with:
   - A clear description of the changes
   - Related issue numbers (e.g., `Closes #123`)
   - Screenshots or recordings for UI changes
   - Any notes for reviewers

4. **Address review feedback** promptly. Make additional commits to your branch as needed.

5. **Ensure CI passes** — all checks (lint, type-check, tests) must be green before merging.

6. **Squash and merge** is the preferred merge strategy to keep history clean.

---

## Coding Standards

### TypeScript

- Always use **TypeScript** for new files. Avoid `any` where possible.
- Prefer `interface` over `type` for object shapes.
- Use `const` and `let` — never `var`.
- Enable strict mode in your IDE (the project has `tsconfig.strict.json`).

### Naming Conventions

- **Files and folders**: `camelCase` for utilities (`errorUtils.ts`), `PascalCase` for components (`ErrorBoundary.tsx`)
- **Functions and variables**: `camelCase`
- **Classes and components**: `PascalCase`
- **Constants**: `UPPER_SNAKE_CASE` for global constants
- **Interfaces**: PascalCase with or without `I` prefix — be consistent within the module

### React / React Native

- Use functional components with hooks.
- Keep components focused and small — extract reusable logic into custom hooks.
- Use React Native's built-in components where possible before creating custom ones.

### Imports Order

1. External / third-party libraries
2. Internal absolute imports (from `src/`)
3. Relative imports
4. Styles / assets

---

## Testing

We use **Jest** as our test runner. Tests live in `__tests__` directories co-located with the source files.

- **Unit tests**: Located in `src/**/__tests__/`
- **Integration tests**: Located in `tests/` or `backend/**/__tests__/`
- **E2E tests**: Located in `e2e/` and `.maestro/`

### Running Tests

```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:ci

# Run specific test file
npx jest src/utils/__tests__/validators.test.ts
```

### Writing Tests

- Aim for **high coverage** — thresholds are configured in `jest.config.js`.
- Use `jest.fn()` for mocking functions.
- Use `it.each` for table-driven tests.
- Keep tests deterministic and fast.

---

## Linting and Formatting

We use **ESLint** for linting and **Prettier** for code formatting.

```bash
# Lint all files
npm run lint

# Auto-fix lint issues
npm run lint:fix

# Format all files with Prettier
npm run format

# Check formatting without writing changes
npm run format:check
```

Linting and formatting are also run automatically on staged files via **lint-staged** (configured in `package.json`) when you commit.

---

## Issue Labelling

We use a consistent labelling system to categorise issues:

| Label              | Description                                  |
|--------------------|----------------------------------------------|
| `bug`              | Something isn't working                      |
| `enhancement`      | New feature or request                       |
| `documentation`    | Improvements or additions to documentation   |
| `good first issue` | Great for newcomers                          |
| `help wanted`      | Extra attention / community help needed      |
| `tests`            | Related to testing                           |
| `tech-debt`        | Code quality / refactoring                   |
| `dependencies`     | Dependency updates                           |
| `security`         | Security-related issues                      |
| `blocked`          | Blocked by another issue or PR               |
| `high-priority`    | Needs immediate attention                    |

When creating a new issue, please add relevant labels to help with triage.

---

## Getting Help

- **GitHub Issues**: Use the [issue tracker](https://github.com/DogStark/PetChain-MobileApp/issues) for bug reports and feature requests.
- **Discussion**: Open a GitHub Discussion for questions or ideas.
- **Security Issues**: See our [Security Policy](.github/SECURITY-README.md) for reporting vulnerabilities.

---

Thank you for contributing to PetChain! 🐾
