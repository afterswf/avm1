/**
 * Copyright 2014 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { ExternalInterfaceService } from '@awayfl/swf-loader';
import { alCoerceString, alIsArray, alIsFunction, alIterateArray, alNewObject } from '../runtime';
import { wrapAVM1NativeClass } from './AVM1Utils';
import { AVM1Context } from '../context';
import { AVM1Object } from '../runtime/AVM1Object';
import { AVM1Function } from '../runtime/AVM1Function';
import { AVM1ArrayNative } from '../natives';

//module Shumway.AVM1.Lib {

const callbacks: Record<string, (args: any[]) => any> = {};
let initialized = false;

function ensureInitialized() {
	if (!initialized) {
		initialized = true;
		ExternalInterfaceService.initJS((functionName: string, args: any[]) => {
			const callback = callbacks[functionName];
			return callback ? callback(args) : undefined;
		});
	}
}

function toJS(context: AVM1Context, value: any, converted: Map<AVM1Object, any> = new Map()): any {
	if (!(value instanceof AVM1Object)) {
		return value;
	}
	if (alIsFunction(value)) {
		return undefined;
	}
	if (converted.has(value)) {
		return converted.get(value);
	}
	if ((<any>value).value instanceof Date) {
		return new Date((<any>value).value.getTime());
	}

	let result: any;
	if (alIsArray(context, value)) {
		result = [];
		converted.set(value, result);
		alIterateArray(context, value, (item) => result.push(toJS(context, item, converted)));
	} else {
		result = {};
		converted.set(value, result);
		for (const key of value.alGetKeys()) {
			result[key] = toJS(context, value.alGet(key), converted);
		}
	}
	return result;
}

function fromJS(context: AVM1Context, value: any, converted: Map<any, any> = new Map()): any {
	if (typeof value === 'function') {
		return undefined;
	}
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (converted.has(value)) {
		return converted.get(value);
	}
	// may come from another window, so instanceof isn't reliable
	if (Object.prototype.toString.call(value) === '[object Date]') {
		return (<AVM1Function>context.builtins.Date).alConstruct([value.getTime()]);
	}

	let result: AVM1Object;
	if (Array.isArray(value)) {
		const items = [];
		result = new AVM1ArrayNative(context, items);
		converted.set(value, result);
		for (let i = 0; i < value.length; i++) {
			items.push(fromJS(context, value[i], converted));
		}
	} else {
		result = alNewObject(context);
		converted.set(value, result);
		for (const key of Object.keys(value)) {
			result.alPut(key, fromJS(context, value[key], converted));
		}
	}
	return result;
}

export class AVM1ExternalInterface extends AVM1Object {
	static createAVM1Class(context: AVM1Context): AVM1Object {
		return wrapAVM1NativeClass(context, true, AVM1ExternalInterface,
			['available#', 'addCallback', 'call'],
			[]);
	}

	public static getAvailable(context: AVM1Context): boolean {
		return ExternalInterfaceService.enabled;
	}

	public static addCallback(context: AVM1Context, methodName: string, instance: any, method: AVM1Function): boolean {
		methodName = alCoerceString(context, methodName);
		if (!alIsFunction(method)) {
			return false;
		}
		try {
			ensureInitialized();
			callbacks[methodName] = (args: any[]) => {
				const avm1Args = args.map((arg) => fromJS(context, arg));
				return toJS(context, context.executeFunction(method, instance, avm1Args));
			};
			ExternalInterfaceService.registerCallback(methodName);

			// previously the only way to reach callbacks, from inside the player's window
			if (!window['flashObject']) {
				window['flashObject'] = {};
			}
			window['flashObject'][methodName] = (<any>window)[ExternalInterfaceService.interfaceID][methodName];

			return true;
		} catch (e) {
			console.warn('[AVM1ExternalInterface] - error in addCallback', e);
		}
		return false;
	}

	public static call(context: AVM1Context, methodName: string, ...parameters: any[]): any {
		methodName = alCoerceString(context, methodName);

		ExternalInterfaceService.ensureInit();
		const id = ExternalInterfaceService.interfaceID;
		const external = (<any>window)[id];

		// evaluated like Flash Player's own call(), so methodName can be a path or an
		// expression; arguments are passed by reference and copied into the
		// evaluating window, which may not be this one
		external.__avm1Args = parameters.map((parameter) => toJS(context, parameter));
		const result = ExternalInterfaceService.eval(
			`${id}.__avm1Result = ${methodName}(...(function (args) {
				try { return structuredClone(args); } catch (e) { return args; }
			})(${id}.__avm1Args))`);

		delete external.__avm1Args;
		delete external.__avm1Result;

		return fromJS(context, result);
	}
}
