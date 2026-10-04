"""Run the official beat tracker with only its required DistilHuBERT upstream."""
import sys
import types
from pathlib import Path

repo = Path(__file__).resolve().parents[1]/'.runtime/midi-sag/repo'
module = repo/'Singing-Vocal-Beat-Tracking'
sys.path.insert(0, str(module))
# s3prl.hub imports every optional upstream (including unrelated training engines).
# The direct import selects the same official model without those side effects.
distil = types.ModuleType('distil_hubert')
distil.__file__ = str(module/'distil_hubert.py')
source = Path(distil.__file__).read_text(encoding='utf8')
source = source.replace('from s3prl.hub import distilhubert',
                        'from s3prl.upstream.distiller.hubconf import distilhubert')
exec(compile(source, distil.__file__, 'exec'), distil.__dict__)
sys.modules['distil_hubert'] = distil
script=module/'inference_vad.py'
namespace={'__name__':'midi_sag_beat_impl','__file__':str(script)}
exec(compile(script.read_text(encoding='utf8'),str(script),'exec'),namespace)
original_load=namespace['load_model']
def load_model(*args,**kwargs):
    model=original_load(*args,**kwargs)
    # The published dill checkpoint contains Python-version-specific lambda bytecode.
    # Rebind the default LinearAttention feature map to its identical official ELU+1
    # expression under the running Python version; learned weights stay untouched.
    import torch.nn.functional as functional
    from fast_transformers.feature_maps.base import ActivationFunctionFeatureMap
    for layer in model.modules():
        if isinstance(layer,ActivationFunctionFeatureMap):
            layer.activation_function=lambda x:functional.elu(x)+1
    return model
namespace['load_model']=load_model
namespace['main']()
