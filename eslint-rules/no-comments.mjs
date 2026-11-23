import { isDirectiveText } from "../scripts/comments/lib.mjs";

const rule = {
  meta: {
    type: "problem",
    schema: [],
    messages: {
      banned: "Comments are banned in this repo. Delete the comment; record decisions in docs/adr/<topic>.md.",
    },
  },
  create(context) {
    return {
      "Program:exit"() {
        for (const comment of context.sourceCode.getAllComments()) {
          if (comment.type === "Shebang" || isDirectiveText(comment.value)) continue;
          context.report({ loc: comment.loc, messageId: "banned" });
        }
      },
    };
  },
};

export default rule;
