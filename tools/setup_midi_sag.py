"""Prepare an isolated MIDI-SAG runtime. Read-only HF login is done interactively.

Use --verify with a real full-song request only after installation; readiness is
never inferred from the existence of a model download or a mocked UI test.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

PROJECT = Path(__file__).resolve().parents[1]
ROOT = PROJECT/'.runtime/midi-sag'
PYTHON = ROOT/'venv/Scripts/python.exe'
REVISIONS = {
    'repo': ('https://github.com/fundwotsai2001/MIDI-SAG.git', 'b79839ed0cdd0b5e5f39d4cc4a80fcc90002d32f'),
    'diffusers': ('https://github.com/fundwotsai2001/diffusers.git', '005980c6ef4830b746caf1b4a42bf9facb3cf092'),
    'madmom': ('https://github.com/fundwotsai2001/madmom.git', '115f176a4a5b303202893fab598e94eca1c29a0e'),
}
DEPENDENCIES = ['numpy==1.26.4','scipy==1.15.3','soundfile==0.13.1','librosa==0.11.0',
    'transformers==4.47.1','accelerate==1.12.0','huggingface-hub==0.36.0','gdown==5.2.0',
    'matplotlib','torchsde','einops','click','colorednoise','dask','h5py','loguru','mido',
    'omegaconf','pydantic','resampy','eval_type_backport','pretty_midi','miditok==3.0.6.post1',
    'chorder','pandas','dill','scikit-learn','sentencepiece','protobuf','tensorboard','tensorboardX',
    'lightning','onnx','Cython','wheel']


def call(*args):
    subprocess.run([str(a) for a in args], check=True, cwd=PROJECT)


def sha(file):
    digest=hashlib.sha256()
    with Path(file).open('rb') as stream:
        for block in iter(lambda:stream.read(8*1024*1024), b''):digest.update(block)
    return digest.hexdigest()


def install():
    ROOT.mkdir(parents=True,exist_ok=True)
    for name,(url,revision) in REVISIONS.items():
        repo=ROOT/name
        if not (repo/'.git').exists():call('git','clone',url,repo)
        current=subprocess.check_output(['git','-C',str(repo),'rev-parse','HEAD'],text=True).strip()
        if current!=revision:
            if subprocess.check_output(['git','-C',str(repo),'status','--porcelain'],text=True).strip():
                raise RuntimeError(f'Preserved modified checkout: {repo}')
            call('git','-C',repo,'checkout','--detach',revision)
    call('git','-C',ROOT/'madmom','submodule','update','--init')
    if not PYTHON.exists():call(sys.executable,'-m','venv',ROOT/'venv')
    call(PYTHON,'-m','pip','install','torch==2.7.1','torchaudio==2.7.1','--index-url','https://download.pytorch.org/whl/cu128')
    call(PYTHON,'-m','pip','install',*DEPENDENCIES)
    call(PYTHON,'-m','pip','install','--no-build-isolation',ROOT/'diffusers',ROOT/'madmom')
    call(PYTHON,'-m','pip','download','pytorch-fast-transformers==0.4.0','--no-deps','--no-build-isolation','-d',ROOT)
    source=ROOT/'pytorch-fast-transformers-0.4.0'
    if not source.exists():
        with tarfile.open(ROOT/'pytorch-fast-transformers-0.4.0.tar.gz') as archive:
            archive.extractall(ROOT,filter='data')
    setup=source/'setup.py'
    text=setup.read_text(encoding='utf8').replace('if cuda_toolkit_available():',
        'if False:  # LinearAttention uses standard PyTorch CUDA; optional kernels are unused.')
    setup.write_text(text,encoding='utf8')
    call(PYTHON,'-m','pip','install','--no-build-isolation',source)
    call(PYTHON,'-m','pip','install','s3prl==0.4.18','--no-deps')


def models():
    from huggingface_hub import HfApi, hf_hub_download, snapshot_download
    import gdown
    # Fail before large transfers if the user's account has no gated-model access.
    base='stabilityai/stable-audio-open-1.0'
    revision=HfApi().model_info(base).sha
    hf_hub_download(base,'model_index.json',revision=revision,local_dir=ROOT/'base-model')
    snapshot_download(base,revision=revision,local_dir=ROOT/'base-model',
                      ignore_patterns=['*.ckpt','*.md','.gitattributes'],max_workers=3)
    weights=ROOT/'repo/MIDI-SAG_checkpoints'
    gdown.download_folder(id='1o6eUCYwUcIzZeqEycar6AHTSQ-vYcL_q',output=str(weights),quiet=True)
    game=ROOT/'game.zip'
    expected='8c5b3e531e2905b935e664e2f533921cd637243770fab5282413bdb5051ca60c'
    if not game.exists() or sha(game)!=expected:
        partial=ROOT/'game.zip.part'
        with urllib.request.urlopen('https://github.com/openvpi/GAME/releases/download/v1.0.0/GAME-1.0-medium.zip',timeout=90) as src,partial.open('wb') as out:
            shutil.copyfileobj(src,out,4*1024*1024)
        if sha(partial)!=expected:raise RuntimeError('GAME checksum mismatch')
        partial.replace(game)
    destination=(ROOT/'repo/GAME').resolve()
    with zipfile.ZipFile(game) as archive:
        for entry in archive.infolist():
            if not (destination/entry.filename).resolve().is_relative_to(destination):
                raise RuntimeError('Unexpected archive path')
        archive.extractall(destination)
    files=[p for p in weights.rglob('*') if p.is_file()]
    manifest={'revisions':REVISIONS,'baseRevision':revision,
              'files':{str(p.relative_to(ROOT)):sha(p) for p in files},'gameSha256':expected}
    (ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf8')


def verify(request):
    data=json.loads(request.read_text(encoding='utf8'))
    if data['start']!=0 or abs(data['end']-data['sourceSeconds'])>.001 or data['end']<60:
        raise RuntimeError('Readiness requires a real full-song check of at least 60 seconds')
    env={**os.environ,'TORCH_FORCE_NO_WEIGHTS_ONLY_LOAD':'1','PYTHONIOENCODING':'utf-8'}
    subprocess.run([str(PYTHON),'-u',str(PROJECT/'tools/midi_sag_worker.py'),'--request',str(request)],
                   env=env,check=True,cwd=PROJECT)
    result=json.loads((request.parent/'result.json').read_text(encoding='utf8'))
    if result['model']!='MIDI-SAG' or result['outputSamples']!=round(data['sourceSeconds']*48000):
        raise RuntimeError('Generated waveform validation failed')
    state={'verified':True,'model':'midi-sag','codeRevision':REVISIONS['repo'][1],
           'scripts':{name:sha(PROJECT/'tools'/name) for name in ['midi_sag_worker.py','midi_sag_beat.py']},'seconds':data['end'],
           'result':str(request.parent/'result.json'),'musicalQualityVerified':False}
    (ROOT/'verified.json').write_text(json.dumps(state,indent=2),encoding='utf8')
    freeze=subprocess.check_output([str(PYTHON),'-m','pip','freeze'],text=True)
    (ROOT/'installed-packages.txt').write_text(freeze,encoding='utf8')


if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--install',action='store_true')
    parser.add_argument('--models',action='store_true')
    parser.add_argument('--verify',type=Path)
    args=parser.parse_args()
    if args.install:install()
    if args.models:models()
    if args.verify:verify(args.verify.resolve())
