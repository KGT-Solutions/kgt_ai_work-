import { showAlert as themedShowAlert, showError, showSuccess } from '../components/AppAlert';

/**
 * Drop-in replacement for Alert.alert — uses themed centered popup.
 * Signature matches React Native Alert.alert(title, message, buttons).
 */
export function showAlert(title, message, buttons) {
  return themedShowAlert(title, message, buttons);
}

export { showError, showSuccess };
