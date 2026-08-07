/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Media module barrel — the platform's single upload system.
 */

export { mediaService, computeStorageMetrics, MediaService } from './mediaService';
export type { StorageMetrics, SaveImageInput, DeleteImageInput, MediaActor } from './mediaService';
export { restaurantImageUpload } from './multerConfig';
export { attachmentUpload } from './attachmentMulterConfig';
export { assertValidImage, detectImageExtension, isAllowedImageMime } from './mediaTypes';
export type { RestaurantMediaKind, RestaurantMediaField } from './mediaTypes';
export {
  assertValidDocument, detectDocumentExtension, isAllowedDocumentMime,
} from './documentTypes';
export {
  uploadRestaurantLogo, uploadRestaurantCover,
  deleteRestaurantLogo, deleteRestaurantCover,
  getRestaurantStorage, toAbsoluteMediaUrl,
} from './restaurantMediaController';
