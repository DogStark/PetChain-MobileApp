# Contributing to PetChain

Welcome to PetChain! We appreciate your contributions.

## Security and Dependency Management

We use GitHub Actions and Dependabot to automate dependency updates and vulnerability scanning. 
If a PR fails the `npm audit` check, you will need to resolve the vulnerabilities before it can be merged.

### Fixing Vulnerabilities
Run the following command locally to automatically fix most issues:
```bash
npm audit fix
```

### Handling False Positives
If `npm audit` reports a vulnerability in a development dependency that does not affect production, you can check production dependencies only:
```bash
npm audit --production
```
If a vulnerability cannot be fixed and is deemed a false positive, please open an issue and document it, or add an `npm audit` bypass configuration if applicable.
