import bigInteger from "big-integer";
// tslint:disable-next-line: no-submodule-imports
import { Buffer } from "buffer/";
import { sha256 } from "sha.js";
import { Codec } from "./codec";
import { ConcreteInfo, TypeInfo } from "./options";
import { Symbols, Type } from "./type";

export const prefixBytesLen = 4;
export const disambBytesLen = 3;
export const disfixBytesLen = prefixBytesLen + disambBytesLen;

export function nameToDisfix(
  name: string
): { disambBytes: Uint8Array; prefixBytes: Uint8Array } {
  const buffer: Buffer = Buffer.from(
    new sha256().update(name).digest("hex"),
    "hex"
  );
  let i = 0;
  while (buffer[i] === 0) {
    i += 1;
  }
  const disambBytes = new Uint8Array(buffer.slice(i, i + disambBytesLen));

  i += disambBytesLen;
  while (buffer[i] === 0) {
    i += 1;
  }
  const prefixBytes = new Uint8Array(buffer.slice(i, i + prefixBytesLen));

  return {
    disambBytes,
    prefixBytes
  };
}

export function setTypeInfo(value: any, typeInfo: TypeInfo) {
  Object.defineProperty(value.constructor, Symbols.typeInfo, {
    value: typeInfo,
    writable: false
  });
}

export function setConcreteInfoForCodec(
  codec: Codec,
  value: any,
  concreteInfo: ConcreteInfo
) {
  const typeInfo = getTypeInfo(codec, value);
  if (typeInfo) {
    Object.defineProperty(value.constructor, codec.symbols.concreteInfo, {
      value: concreteInfo,
      writable: false
    });
  } else {
    throw new Error("can't set concrete info for unregistered type");
  }
}

export function getTypeInfo(codec: Codec, value: any): TypeInfo | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(
    value.constructor,
    Symbols.typeInfo
  );
  if (!descriptor) {
    return undefined;
  }
  let typeInfo: TypeInfo = descriptor.value;

  const concreteDescriptor = Object.getOwnPropertyDescriptor(
    value.constructor,
    codec.symbols.concreteInfo
  );
  if (!concreteDescriptor) {
    return typeInfo;
  } else {
    // shallow copy
    typeInfo = { ...typeInfo };
    typeInfo.concreteInfo = concreteDescriptor.value;
    return typeInfo;
  }
}

export function deferTypeInfo(
  codec: Codec,
  info: TypeInfo,
  value: any,
  fieldKey: string,
  forJSON: boolean = false
): [TypeInfo, any] {
  let deferedValue: any = value;
  let deferedInfo: TypeInfo | undefined = info;

  if (fieldKey) {
    deferedValue = value[fieldKey];
    if (deferedValue == null) {
      throw new Error("invalid field key");
    }
    deferedInfo = value[Symbols.fieldTypeInfoMap][fieldKey];
    if (!deferedInfo) {
      throw new Error("undefined type info");
    }

    if (deferedInfo.type === Type.Defined) {
      deferedInfo = getTypeInfo(codec, deferedValue);

      if (!deferedInfo) {
        throw new Error("unregisterd type");
      }
    }
  }

  let i = 0;
  while (deferedInfo.type === Type.Defined) {
    if (typeof deferedValue === "object") {
      deferedInfo = getTypeInfo(codec, deferedValue);
      if (!deferedInfo) {
        throw new Error("unregisterd type");
      }
      if (deferedInfo.type !== Type.Defined) {
        break;
      }

      const propertyKey = deferedValue[Symbols.typeToPropertyKey];
      if (!propertyKey) {
        throw new Error("property key unknown");
      }
      deferedValue = deferedValue[propertyKey];
      if (deferedValue == null) {
        throw new Error("invalid property");
      }
    }

    i += 1;
    if (i >= 10) {
      throw new Error("too deep definition or may invalid type");
    }
  }

  if (
    (!forJSON || (forJSON && !deferedValue.marshalJSON)) &&
    (!deferedInfo.concreteInfo ||
      (!deferedInfo.concreteInfo.aminoMarshalerMethod &&
        !deferedInfo.concreteInfo.aminoMarshalPeprType))
  ) {
    if (
      deferedInfo.type !== Type.Struct &&
      deferedInfo.type !== Type.Interface
    ) {
      if (
        !(deferedValue instanceof bigInteger) &&
        typeof deferedValue === "object" &&
        !(deferedValue instanceof Uint8Array) &&
        !Array.isArray(deferedValue) &&
        !Buffer.isBuffer(deferedValue)
      ) {
        const propertyKey = deferedValue[Symbols.typeToPropertyKey];
        if (!propertyKey) {
          throw new Error("property key unknown");
        }

        deferedValue = deferedValue[propertyKey];
      }
    }
  }

  return [deferedInfo, deferedValue];
}
