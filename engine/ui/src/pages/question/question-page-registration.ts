import { QuestionPage } from "./question-page.ts";

if (!customElements.get("branch-question-page")) {
  customElements.define("branch-question-page", QuestionPage);
}
