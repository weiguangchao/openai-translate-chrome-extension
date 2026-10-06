import { startContentScript } from '../../core/content';
import { createXPlatform } from './platform';

startContentScript(createXPlatform);
