import { StepRegistry } from "./step-registry.ts";
import { UnderstandRequestProcessor } from "./steps/understand-request.ts";
import { SearchInformationProcessor } from "./steps/search-information.ts";
import { PrepareRecommendationProcessor } from "./steps/prepare-recommendation.ts";
import { CreateDocumentProcessor } from "./steps/create-document.ts";
import { ProduceResponseProcessor } from "./steps/produce-response.ts";

// Available actions, not a predefined execution plan.
export const stepRegistry = new StepRegistry([
  UnderstandRequestProcessor,
  SearchInformationProcessor,
  PrepareRecommendationProcessor,
  CreateDocumentProcessor,
  ProduceResponseProcessor,
]);
