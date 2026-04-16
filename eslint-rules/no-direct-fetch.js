export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow direct `fetch()` calls outside the `data/api.ts` wrapper module.",
    },
    schema: [],
    messages: {
      direct:
        "Use apiGet/apiPost from `data/api.ts` instead of calling `fetch` directly. The wrapper centralises auth headers, error handling, and response parsing.",
    },
  },
  create(context) {
    return {
      CallExpression(node) {
        const c = node.callee;
        const isFetch =
          (c.type === "Identifier" && c.name === "fetch") ||
          (c.type === "MemberExpression" &&
            c.property?.type === "Identifier" &&
            c.property.name === "fetch");
        if (isFetch) context.report({ node, messageId: "direct" });
      },
    };
  },
};
