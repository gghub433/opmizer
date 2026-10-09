// Entry point for the browser bundle (see tools/build-sdk-bundle.sh).
// The IIFE exposes window.AnthropicSDK = { default: Anthropic, Anthropic }.
import Anthropic from '@anthropic-ai/sdk';
export default Anthropic;
export { Anthropic };
