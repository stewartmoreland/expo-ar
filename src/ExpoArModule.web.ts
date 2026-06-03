import { registerWebModule, NativeModule } from 'expo';

// ExpoArModule is not available on the web platform.
class ExpoArModule extends NativeModule<{}> {}

export default registerWebModule(ExpoArModule, 'ExpoArModule');
