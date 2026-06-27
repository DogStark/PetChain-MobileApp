/**
 * ESLint rule: no-touchable-without-accessible-text
 *
 * Warns when a TouchableOpacity (or Pressable) has no accessible text — i.e.
 * it carries neither:
 *   - an `accessibilityLabel` prop, nor
 *   - at least one direct or nested <Text> child whose value is statically
 *     knowable (string literal or JSX expression that resolves to a string).
 *
 * Screen-reader users who encounter a button with no accessible text hear only
 * the component type ("button") with no indication of purpose.
 *
 * This rule fires as a *warning* so it does not block CI but is visible in the
 * editor. Upgrade to 'error' once the codebase is fully compliant.
 *
 * @type {import('eslint').Rule.RuleModule}
 */

'use strict';

const TOUCHABLE_NAMES = new Set([
  'TouchableOpacity',
  'TouchableHighlight',
  'TouchableNativeFeedback',
  'TouchableWithoutFeedback',
  'Pressable',
]);

/**
 * Walk JSX children recursively and return true if any <Text> descendant
 * contains a non-empty string literal or a JSX expression child.
 */
function hasTextDescendant(node) {
  if (!node) return false;

  // JSX element — check if it is a <Text> with content, or recurse into children
  if (node.type === 'JSXElement') {
    const opening = node.openingElement;
    const name =
      opening.name.type === 'JSXIdentifier'
        ? opening.name.name
        : opening.name.type === 'JSXMemberExpression'
          ? opening.name.property.name
          : null;

    if (name === 'Text') {
      // Has at least one non-whitespace child
      return node.children.some(
        (child) =>
          (child.type === 'JSXText' && child.value.trim().length > 0) ||
          child.type === 'JSXExpressionContainer',
      );
    }

    // Recurse into any other element's children
    return node.children.some(hasTextDescendant);
  }

  // JSX fragment — recurse
  if (node.type === 'JSXFragment') {
    return node.children.some(hasTextDescendant);
  }

  return false;
}

/**
 * Return true if the JSX opening element has a non-empty `accessibilityLabel`
 * or `aria-label` prop.
 */
function hasAccessibilityLabel(openingElement) {
  return openingElement.attributes.some((attr) => {
    if (attr.type !== 'JSXAttribute') return false;
    const attrName =
      attr.name.type === 'JSXIdentifier' ? attr.name.name : null;

    if (attrName !== 'accessibilityLabel' && attrName !== 'aria-label') return false;

    // accessibilityLabel={undefined} or accessibilityLabel="" → does not count
    if (!attr.value) return false; // bare prop without value (unusual)
    if (
      attr.value.type === 'StringLiteral' ||
      attr.value.type === 'Literal'
    ) {
      return attr.value.value.trim().length > 0;
    }
    // JSX expression: {someVar} or {t('key')} — we can't statically evaluate,
    // but we trust the developer has provided a meaningful value.
    if (attr.value.type === 'JSXExpressionContainer') {
      const expr = attr.value.expression;
      // {""} or {''} → empty string literal → does not count
      if (
        (expr.type === 'StringLiteral' || expr.type === 'Literal') &&
        typeof expr.value === 'string'
      ) {
        return expr.value.trim().length > 0;
      }
      // Any other expression (variable, function call) → trust it
      return expr.type !== 'JSXEmptyExpression';
    }
    return false;
  });
}

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Warn when TouchableOpacity / Pressable has no accessible text ' +
        '(no accessibilityLabel prop and no <Text> child).',
      category: 'Accessibility',
      recommended: false,
      url: 'https://reactnative.dev/docs/accessibility#accessibilitylabel',
    },
    schema: [],
    messages: {
      missingAccessibleText:
        "'{{name}}' has no accessible text. " +
        "Add an `accessibilityLabel` prop or a <Text> child so screen readers " +
        'can announce what this button does.',
    },
  },

  create(context) {
    return {
      JSXOpeningElement(node) {
        const elementName =
          node.name.type === 'JSXIdentifier'
            ? node.name.name
            : node.name.type === 'JSXMemberExpression'
              ? node.name.property.name
              : null;

        if (!elementName || !TOUCHABLE_NAMES.has(elementName)) return;

        // If it has accessibilityLabel / aria-label → OK
        if (hasAccessibilityLabel(node)) return;

        // Walk the parent JSXElement's children for a Text descendant
        const jsxElement = node.parent;
        if (jsxElement && jsxElement.children && jsxElement.children.some(hasTextDescendant)) {
          return;
        }

        context.report({
          node,
          messageId: 'missingAccessibleText',
          data: { name: elementName },
        });
      },
    };
  },
};
