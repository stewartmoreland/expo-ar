import { NativeModule, requireNativeModule } from 'expo';

declare class ExpoArModule extends NativeModule<{}> {}

export default requireNativeModule<ExpoArModule>('ExpoAr');
